# Consumed by scripts/deploy.sh, which reads these rather than hardcoding names.

output "api_service_account" {
  description = "Service account email for the API Cloud Run service."
  value       = google_service_account.api.email
}

output "worker_service_account" {
  description = "Service account email for the worker Cloud Run service."
  value       = google_service_account.worker.email
}

output "tasks_invoker_service_account" {
  description = "OIDC identity Cloud Tasks presents to the worker. Set as TASKS_INVOKER_SA on the API."
  value       = google_service_account.tasks_invoker.email
}

output "queue_name" {
  description = "Cloud Tasks queue name."
  value       = google_cloud_tasks_queue.research.name
}

output "trace_bucket" {
  description = "GCS bucket for retrieval traces. Set as GCS_TRACE_BUCKET on the worker."
  value       = google_storage_bucket.traces.name
}

output "backend_api_key_secret" {
  description = "Secret Manager secret holding BACKEND_API_KEY. The value must be added out of band."
  value       = google_secret_manager_secret.backend_api_key.secret_id
}
