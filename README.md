# QueueKitchen: Amazon SQS demo

**Selected AWS service: Amazon SQS.** Orders are SQS messages. An AWS Lambda "chef" consumes them
through an event source mapping. DynamoDB only stores order status for the screen.

## What it shows
- Send, receive, delete, visibility timeout, delay, short vs long polling (SQS playground tab)
- Standard queue with Lambda trigger, retries, and dead-letter queue after 3 receives (Kitchen tab)
- Enhancements: chef failure-rate slider, one-click DLQ redrive (real `StartMessageMoveTask`), free-tier cost estimator

## Architecture
Website (GitHub Pages) -> Lambda Function URL (`order-api`) -> SQS `kitchen-orders` -> Lambda `chef-worker`
-> DynamoDB. Failures go to SQS `kitchen-burnt` (DLQ). `kitchen-playground` is a trigger-free queue.

## Run
Set `API_URL` in `script.js` to your Function URL and open `index.html`.

Live link: <add after deployment>
Screenshots / demo video: <add>
