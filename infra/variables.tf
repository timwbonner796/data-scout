variable "region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t3.micro"
}

variable "app_port" {
  description = "Port the application listens on"
  type        = number
  default     = 8000
}

variable "auth_username" {
  description = "Basic auth username for the app"
  default     = "datascout"
}

variable "auth_password" {
  description = "Basic auth password for the app"
  sensitive   = true
}

variable "cert_email" {
  description = "Email for Let's Encrypt certificate notifications"
  sensitive   = true
}