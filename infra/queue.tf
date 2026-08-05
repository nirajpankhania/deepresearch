# Cloud Tasks is the dispatch mechanism rather than Pub/Sub because this is
# per-task dispatch, not fan-out. Three properties are doing the work:
#
#   1. Named tasks. The API enqueues as `task-{taskId}`, so a duplicate enqueue
#      is rejected by the service with ALREADY_EXISTS instead of producing a
#      second run. Idempotency without application-level bookkeeping.
#   2. Declarative retry. The policy below is queue configuration, not code in
#      the worker that has to be written, tested and kept correct.
#   3. OIDC push. Cloud Tasks calls the worker with a signed token, so the
#      worker requires an authenticated invoker and is never publicly reachable.
resource "google_cloud_tasks_queue" "research" {
  name     = var.queue_name
  location = var.region

  rate_limits {
    # The worker runs one research task per instance (Cloud Run concurrency=1),
    # so the useful throttle is on concurrent dispatches. Kept low: each task
    # spends real money, and a runaway queue is a billing incident.
    max_dispatches_per_second = 5
    max_concurrent_dispatches = 10
  }

  retry_config {
    max_attempts = var.max_attempts

    # A task that has been retrying for a full worker timeout plus margin is
    # not going to succeed; stop rather than keep paying for attempts.
    max_retry_duration = "${var.worker_timeout_seconds * var.max_attempts}s"

    min_backoff = "10s"
    max_backoff = "300s"
    # Doubling, so the three attempts are spread rather than bunched.
    max_doublings = 3
  }

  stackdriver_logging_config {
    sampling_ratio = 1.0
  }
}
