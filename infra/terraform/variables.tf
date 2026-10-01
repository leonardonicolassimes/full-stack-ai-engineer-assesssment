variable "name" {
  type    = string
  default = "ticket-extractor"
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "azs" {
  description = "Two availability zones (listed explicitly so plan needs no AWS API calls)."
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

variable "mock_mode" {
  description = "Run offline with dummy credentials (plan/validate only)."
  type        = bool
  default     = false
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "image_tag" {
  type    = string
  default = "latest"
}

variable "certificate_arn" {
  description = "ACM certificate for HTTPS. Empty = HTTP only (dev). Production must set this."
  type        = string
  default     = ""
}

variable "cors_origin" {
  type    = string
  default = "https://app.example.com"
}

# --- capacity ---
variable "task_cpu" {
  type    = number
  default = 512
}

variable "task_memory" {
  type    = number
  default = 1024
}

variable "min_tasks" {
  type    = number
  default = 2
}

variable "max_tasks" {
  type    = number
  default = 20
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_multi_az" {
  type    = bool
  default = true
}

# --- app config (non-secret) ---
variable "llm_provider" {
  type    = string
  default = "anthropic"
}

variable "prompt_version" {
  type    = string
  default = "v1"
}

variable "daily_token_budget" {
  type    = number
  default = 200000
}
