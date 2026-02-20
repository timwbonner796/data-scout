

output "ecr_repository_url" {
  description = "ECR repository URL for pushing Docker images"
  value       = aws_ecr_repository.app.repository_url
}

output "ssh_command" {
  description = "SSH command to connect to the instance"
  value       = "ssh -i ${local_file.ssh_key.filename} ec2-user@${aws_instance.app.public_ip}"
}

output "app_url" {
  description = "URL to access Data Scout"
  value       = "http://datascout.momentscout.com:${var.app_port}"
}

output "elastic_ip" {
  value       = aws_eip.app.public_ip
  description = "Static public IP for the instance"
}