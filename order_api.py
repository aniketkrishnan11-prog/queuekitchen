import json, os, time, uuid
from decimal import Decimal
import boto3

sqs = boto3.client("sqs")
table = boto3.resource("dynamodb").Table(os.environ["TABLE"])
Q, DLQ = os.environ["QUEUE_URL"], os.environ["DLQ_URL"]
DLQ_ARN, PG = os.environ["DLQ_ARN"], os.environ["PG_QUEUE_URL"]
MENU = {"Pizza", "Burger", "Pasta", "Dosa", "Biryani"}


def dec(o):
    if isinstance(o, Decimal):
        return int(o) if o == int(o) else float(o)
    return str(o)


def resp(code, body):
    # CORS headers are added by the Function URL settings, not here
    return {"statusCode": code, "headers": {"Content-Type": "application/json"},
            "body": json.dumps(body, default=dec)}


def counts(url):
    a = sqs.get_queue_attributes(QueueUrl=url, AttributeNames=["All"])["Attributes"]
    return (int(a["ApproximateNumberOfMessages"]),
            int(a["ApproximateNumberOfMessagesNotVisible"]),
            int(a.get("ApproximateNumberOfMessagesDelayed", 0)))


def body_of(event):
    try:
        return json.loads(event.get("body") or "{}")
    except Exception:
        return {}


def handler(event, context):
    http = event["requestContext"]["http"]
    method, path = http["method"], event["rawPath"]
    d = body_of(event)

    try:
        # ---------- Kitchen (SQS + Lambda trigger) ----------
        if method == "POST" and path == "/order":
            if d.get("item") not in MENU:
                return resp(400, {"error": "unknown item"})
            oid = str(uuid.uuid4())[:8]
            table.put_item(Item={"orderId": oid, "item": d["item"], "status": "QUEUED",
                                 "attempts": 0, "createdAt": int(time.time())})
            sqs.send_message(QueueUrl=Q, MessageBody=json.dumps(
                {"orderId": oid, "item": d["item"]}))
            return resp(200, {"orderId": oid})

        if method == "GET" and path == "/status":
            waiting, cooking, _ = counts(Q)
            burnt, _, _ = counts(DLQ)
            items = table.scan()["Items"]
            cfg = next((i for i in items if i["orderId"] == "CONFIG"), {})
            orders = sorted((i for i in items if i["orderId"] != "CONFIG"),
                            key=lambda o: o["createdAt"], reverse=True)[:15]
            return resp(200, {"waiting": waiting, "cooking": cooking, "burnt": burnt,
                              "failRate": cfg.get("failRate", 0), "orders": orders})

        if method == "POST" and path == "/config":
            rate = max(0, min(100, int(d.get("failRate", 0))))
            table.put_item(Item={"orderId": "CONFIG", "createdAt": 0, "failRate": rate})
            return resp(200, {"failRate": rate})

        if method == "POST" and path == "/redrive":
            r = sqs.start_message_move_task(SourceArn=DLQ_ARN)  # back to original queue
            return resp(200, {"task": r["TaskHandle"]})

        # ---------- Playground (raw SQS operations, no trigger) ----------
        if method == "POST" and path == "/pg/send":
            r = sqs.send_message(QueueUrl=PG, MessageBody=str(d.get("text", "hello"))[:200],
                                 DelaySeconds=max(0, min(30, int(d.get("delay", 0)))))
            return resp(200, {"messageId": r["MessageId"]})

        if method == "POST" and path == "/pg/receive":
            wait = 5 if d.get("longPoll") else 0
            r = sqs.receive_message(QueueUrl=PG, MaxNumberOfMessages=1, VisibilityTimeout=15,
                                    WaitTimeSeconds=wait,
                                    AttributeNames=["ApproximateReceiveCount"])
            m = (r.get("Messages") or [None])[0]
            return resp(200, {"message": m})

        if method == "POST" and path == "/pg/delete":
            sqs.delete_message(QueueUrl=PG, ReceiptHandle=d["receiptHandle"])
            return resp(200, {"deleted": True})

        if method == "GET" and path == "/pg/stats":
            v, n, dl = counts(PG)
            return resp(200, {"visible": v, "inflight": n, "delayed": dl})

        return resp(404, {"error": "not found"})
    except Exception as e:
        return resp(500, {"error": str(e)[:200]})
