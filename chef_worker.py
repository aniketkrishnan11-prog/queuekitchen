import json, os, time, random
import boto3

table = boto3.resource("dynamodb").Table(os.environ["TABLE"])


def set_status(oid, status, attempt):
    table.update_item(
        Key={"orderId": oid},
        UpdateExpression="SET #s=:s, attempts=:a",
        ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": status, ":a": attempt})


def handler(event, context):
    for rec in event["Records"]:
        order = json.loads(rec["body"])
        oid = order["orderId"]
        attempt = int(rec["attributes"]["ApproximateReceiveCount"])
        set_status(oid, "COOKING", attempt)
        time.sleep(random.uniform(2, 4))
        cfg = table.get_item(Key={"orderId": "CONFIG"}).get("Item", {})
        if random.random() * 100 < float(cfg.get("failRate", 0)):
            set_status(oid, "BURNT" if attempt >= 3 else "RETRYING", attempt)
            raise Exception("Order burnt!")  # message returns to the queue
        set_status(oid, "SERVED", attempt)    # success: Lambda deletes the message
