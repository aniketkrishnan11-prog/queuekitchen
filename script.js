const API_URL = "https://bppbqgqmu4yh6wkuewv4ytg54q0tulri.lambda-url.us-east-1.on.aws/";

const $ = s => document.querySelector(s);
const EMOJI = {Pizza:"🍕",Burger:"🍔",Pasta:"🍝",Dosa:"🥞",Biryani:"🍛"};

async function api(path, method = "GET", body) {
  const r = await fetch(API_URL.replace(/\/$/, "") + path, {
    method,
    headers: body ? {"Content-Type": "application/json"} : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.status);
  return data;
}

function conn(ok) {
  const c = $("#conn");
  c.textContent = ok ? "backend online" : "backend offline";
  c.className = "pill " + (ok ? "ok" : "bad");
}

function log(text, kind = "") {
  const d = document.createElement("div");
  if (kind) d.className = kind;
  const t = document.createElement("time");
  t.textContent = new Date().toLocaleTimeString();
  d.append(t, text);
  $("#log").prepend(d);
}

const say = t => $("#caption").textContent = t;

function setNum(id, v) {
  const el = $(id);
  if (el.textContent !== String(v)) {
    el.textContent = v;
    const node = el.closest(".node");
    node.classList.add("pulse");
    setTimeout(() => node.classList.remove("pulse"), 700);
  }
}

// ---------- automatic lane ----------
const EVENTS = {
  QUEUED:   (id, a) => ["Order #" + id + " sent to the SQS queue", ""],
  COOKING:  (id, a) => ["Order #" + id + " received by Lambda (receive count " + a + "), hidden for the 30 s visibility timeout", ""],
  RETRYING: (id, a) => ["Order #" + id + " failed. It returns to the queue when the timeout ends (attempt " + a + " of 3)", "bad"],
  BURNT:    (id, a) => ["Order #" + id + " failed 3 times. SQS moves it to the dead-letter queue", "bad"],
  SERVED:   (id, a) => ["Order #" + id + " succeeded. Lambda deleted the message from the queue", "ok"]
};
let prev = {}, first = true, sliderLoaded = false, lastTotal = 0;

function caption(s) {
  if (s.cooking > 0) say("A message is in flight. SQS hides it for the 30 s visibility timeout while the chef works. If the chef fails, it returns with a higher receive count.");
  else if (s.waiting > 0) say("Messages are waiting in the queue. Lambda's event source mapping polls the queue and picks them up.");
  else if (s.burnt > 0) say("Orders that failed 3 times sit in the dead-letter queue, so they don't loop forever. Redrive sends them back to the main queue.");
  else say("Queue is empty. Send an order or run a quick demo.");
}

function render(s, p) {
  setNum("#waiting", s.waiting); setNum("#cooking", s.cooking);
  setNum("#served", s.served); setNum("#burnt", s.burnt);
  setNum("#pgV", p.visible); setNum("#pgI", p.inflight); setNum("#pgD", p.delayed);
  if (!sliderLoaded) { $("#rate").value = s.failRate; $("#rateVal").textContent = s.failRate; sliderLoaded = true; }

  [...s.orders].reverse().forEach(o => {
    const key = o.status + "|" + o.attempts;
    if (!first && prev[o.orderId] !== key && EVENTS[o.status]) {
      const [msg, kind] = EVENTS[o.status](o.orderId, o.attempts);
      log(msg, kind);
    }
    prev[o.orderId] = key;
  });
  first = false;

  $("#orders").innerHTML = s.orders.length ? s.orders.map(o => {
    const tries = o.attempts > 0 && o.status !== "SERVED" ? " (try " + o.attempts + ")" : "";
    return '<div class="order"><span>' + (EMOJI[o.item] || "🍽️") + " " + o.item +
           " <small>#" + o.orderId + '</small></span><span class="badge ' + o.status + '">' + o.status + tries + "</span></div>";
  }).join("") : '<p class="hint">No orders yet.</p>';

  lastTotal = s.total; cost();
  caption(s);
}

async function sendOrder() {
  const item = $("#item").value;
  const r = await api("/order", "POST", {item});
  log("You placed an order for " + item + " (#" + r.orderId + ")");
}
async function setRate(v) {
  await api("/config", "POST", {failRate: v});
  $("#rate").value = v; $("#rateVal").textContent = v;
}
async function redrive() {
  await api("/redrive", "POST", {});
  log("Redrive started: SQS moves dead-letter messages back to the main queue", "ok");
}
const safe = fn => async () => { try { await fn(); refresh(); } catch (e) { log("Error: " + e.message, "bad"); } };

$("#order").onclick = safe(sendOrder);
$("#redrive").onclick = safe(redrive);
$("#rate").oninput = e => $("#rateVal").textContent = e.target.value;
$("#rate").onchange = safe(() => setRate(+$("#rate").value).then(() => log("Chef failure rate set to " + $("#rate").value + "%")));
$("#pHappy").onclick = safe(async () => { await setRate(0); log("Demo: chef failure rate 0%"); await sendOrder(); });
$("#pFail").onclick = safe(async () => { await setRate(100); log("Demo: chef failure rate 100%, every attempt will fail", "bad"); await sendOrder(); });
$("#pRescue").onclick = safe(async () => { await setRate(0); log("Demo: chef fixed (failure rate 0%)"); await redrive(); });

// ---------- manual lane ----------
let held = null, timer = null;
$("#send").onclick = safe(async () => {
  const delay = +$("#delay").value || 0;
  const r = await api("/pg/send", "POST", {text: $("#txt").value || "hello", delay});
  log("Manual: SEND ok, MessageId " + r.messageId.slice(0, 8) + "…, delay " + delay + "s");
});
$("#recv").onclick = safe(async () => {
  const lp = $("#lp").checked, t0 = Date.now();
  log(lp ? "Manual: RECEIVE with long polling, waiting up to 5 s" : "Manual: RECEIVE with short polling");
  const r = await api("/pg/receive", "POST", {longPoll: lp});
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (!r.message) { log("Manual: empty receive after " + secs + " s"); return; }
  held = r.message;
  log('Manual: received "' + held.Body + '" after ' + secs + " s, receive count " + held.Attributes.ApproximateReceiveCount);
  showHeld(15);
});

function showHeld(left) {
  clearInterval(timer);
  const box = $("#held"); box.hidden = false;
  const draw = () => {
    box.innerHTML = '<div class="ring" style="--p:' + (left / 15 * 100) + '"><span>' + left + '</span></div>' +
      "<div><div>Body: <b></b></div><div>MessageId: " + held.MessageId.slice(0, 13) + "…</div>" +
      "<div>Receive count: " + held.Attributes.ApproximateReceiveCount + "</div>" +
      '<div>Hidden from other consumers. Delete it before the timer ends.</div>' +
      '<button id="del" class="primary">Delete message</button></div>';
    box.querySelector("b").textContent = held.Body;
    $("#del").onclick = async () => {
      clearInterval(timer);
      try { await api("/pg/delete", "POST", {receiptHandle: held.ReceiptHandle}); log("Manual: DELETE ok, message is gone", "ok"); }
      catch (e) { log("Manual: delete failed: " + e.message, "bad"); }
      held = null; box.hidden = true; refresh();
    };
  };
  draw();
  timer = setInterval(() => {
    left--;
    if (left <= 0) {
      clearInterval(timer); box.hidden = true; held = null;
      log("Manual: visibility timeout ended, the message is visible in the queue again", "bad"); refresh();
    } else draw();
  }, 1000);
}

// ---------- cost meter ----------
function meter(label, v) {
  const pct = v / 1e6 * 100;
  return "<div>" + label + ": <b>" + v.toLocaleString() + "</b> (" + pct.toFixed(2) + "% of 1M)" +
    '<div class="bar ' + (pct > 100 ? "over" : "") + '"><i style="width:' + Math.min(pct, 100) + '%"></i></div></div>';
}
function cost() {
  const perDay = +$("#perDay").value;
  $("#perDayV").textContent = perDay.toLocaleString();
  $("#costNow").innerHTML = "<p class='hint'>So far: <b>" + lastTotal + "</b> orders ≈ " + (lastTotal * 3) + " SQS requests.</p>";
  $("#costOut").innerHTML = meter("SQS requests a month", perDay * 30 * 3) + meter("Lambda invocations a month", perDay * 30);
}
$("#perDay").oninput = cost;

// ---------- polling ----------
async function refresh() {
  try {
    const [s, p] = await Promise.all([api("/status"), api("/pg/stats")]);
    conn(true); render(s, p);
  } catch (e) { conn(false); }
}
cost(); refresh(); setInterval(refresh, 2000);