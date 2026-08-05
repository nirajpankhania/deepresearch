variable "project_id" {
  description = "GCP project hosting every resource in this configuration."
  type        = string
  default     = "deepresearch-504612"
}

variable "region" {
  description = "Region for Cloud Run, Cloud Tasks and GCS. Firestore lives in eur3 and was created outside Terraform."
  type        = string
  default     = "europe-west2"
}

variable "queue_name" {
  description = "Cloud Tasks queue that dispatches research tasks to the worker."
  type        = string
  default     = "research-tasks"
}

variable "max_attempts" {
  description = <<-EOT
    Delivery attempts per task before Cloud Tasks gives up. Bounded because
    every attempt costs real money in Valyu searches and model calls, and a
    task that has failed twice for a deterministic reason will fail again.
  EOT
  type        = number
  default     = 3
}

variable "worker_timeout_seconds" {
  description = <<-EOT
    Per-task maximum runtime. This is the Cloud Run request timeout on the
    worker service, which is what actually enforces the brief's step/runtime
    limit; the queue's dispatch deadline is set to match so Cloud Tasks does
    not retry a task that is still legitimately running.
  EOT
  type        = number
  default     = 900
}

variable "trace_retention_days" {
  description = "Age at which raw retrieval traces are deleted. They are debugging and example-output artefacts, not durable records."
  type        = number
  default     = 30
}
