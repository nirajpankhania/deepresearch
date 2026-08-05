# Raw retrieval traces: the exact Valyu responses and generated queries for each
# task. These are too large to belong in a Firestore document, and they are also
# the "example output" deliverable, so they need to be durable and inspectable
# rather than merely logged.
resource "google_storage_bucket" "traces" {
  name     = "${var.project_id}-traces"
  location = var.region

  # No object ACLs; access is by IAM only.
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  lifecycle_rule {
    condition {
      age = var.trace_retention_days
    }
    action {
      type = "Delete"
    }
  }

  # Traces are reproducible by re-running a task, so versioning would store
  # cost without storing anything of value.
  versioning {
    enabled = false
  }
}
