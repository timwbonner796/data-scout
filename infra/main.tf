# ─── Provider ────────────────────────────────────────────────────────────────

provider "aws" {
  region = var.region
}

# ─── Data Sources ────────────────────────────────────────────────────────────

# Look up the current AWS account ID dynamically (avoids hardcoding it)
data "aws_caller_identity" "current" {}

# Look up the latest Amazon Linux 2023 AMI so we never hardcode an AMI ID
data "aws_ami" "amazon_linux" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# ─── ECR Repository ─────────────────────────────────────────────────────────

# Private container registry for our Docker image
resource "aws_ecr_repository" "app" {
  name                 = "data-scout"
  image_tag_mutability = "MUTABLE"
  force_delete         = true # allows terraform destroy to delete the repo even if it contains images
}

# ─── Security Group ─────────────────────────────────────────────────────────

# Firewall rules controlling which traffic can reach (and leave) the instance
resource "aws_security_group" "app" {
  name        = "data-scout-sg"
  description = "Allow app and SSH traffic"

  # HTTPS traffic
  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # HTTP — for Let's Encrypt verification and redirect to HTTPS
  ingress {
    description = "HTTP for cert verification and redirect"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Allow all outbound traffic (needed for pulling Docker images, yum updates, etc.)
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# ─── SSH Key Pair ────────────────────────────────────────────────────────────

# Generate a TLS private key (RSA 4096-bit)
resource "tls_private_key" "ssh" {
  algorithm = "RSA"
  rsa_bits  = 4096
}

# Register the public half with AWS so EC2 can install it on new instances
resource "aws_key_pair" "app" {
  key_name   = "data-scout-key"
  public_key = tls_private_key.ssh.public_key_openssh
}

# Write the private key to a local .pem file with restrictive permissions
resource "local_file" "ssh_key" {
  content         = tls_private_key.ssh.private_key_pem
  filename        = "${path.module}/data-scout-key.pem"
  file_permission = "0400"
}

# ─── IAM Role & Instance Profile ────────────────────────────────────────────

# IAM role that the EC2 instance will assume
resource "aws_iam_role" "ec2" {
  name = "data-scout-ec2-role"

  # Trust policy: only EC2 can assume this role
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
    }]
  })
}

# Attach the managed policy that grants read-only access to ECR
# (enough to pull images, but not push or delete)
resource "aws_iam_role_policy_attachment" "ecr_read" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

# Allow Session Manager access (replaces SSH)
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# Instance profile is the "wrapper" that lets us attach the IAM role to an EC2 instance
resource "aws_iam_instance_profile" "ec2" {
  name = "data-scout-ec2-profile"
  role = aws_iam_role.ec2.name
}

# ─── EC2 Instance ────────────────────────────────────────────────────────────

resource "aws_instance" "app" {
  ami                    = data.aws_ami.amazon_linux.id
  instance_type          = var.instance_type
  key_name               = aws_key_pair.app.key_name
  vpc_security_group_ids = [aws_security_group.app.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name

  root_block_device {
    volume_size = 20  # GB
    volume_type = "gp3"
  }

  # Startup script: install Docker, pull our image from ECR, and run it.
  # This runs once when the instance first boots.
  user_data = <<-EOF
    #!/bin/bash
    set -e

    # Install Docker
    yum update -y
    yum install -y docker
    systemctl start docker
    systemctl enable docker

    # Authenticate to ECR (the instance role grants read-only access)
    aws ecr get-login-password --region ${var.region} \
      | docker login --username AWS --password-stdin \
        ${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.region}.amazonaws.com

    # Pull and run the application
    docker pull ${aws_ecr_repository.app.repository_url}:latest
    docker run -d --restart unless-stopped -p ${var.app_port}:${var.app_port} \
      ${aws_ecr_repository.app.repository_url}:latest
  EOF

  tags = {
    Name = "data-scout"
  }
}

# ─── Elastic IP ──────────────────────────────────────────────────────────────

# Static public IP that survives instance restarts
resource "aws_eip" "app" {
  domain = "vpc"

  tags = {
    Name = "data-scout-eip"
  }
}

# Attach the elastic IP to our instance
resource "aws_eip_association" "app" {
  instance_id   = aws_instance.app.id
  allocation_id = aws_eip.app.id
}

# ─── DNS ─────────────────────────────────────────────────────────────────────

# Look up the hosted zone that Route 53 created when we registered the domain
data "aws_route53_zone" "main" {
  name = "momentscout.com"
}

# Point datascout.momentscout.com to our elastic IP
resource "aws_route53_record" "datascout" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = "datascout.momentscout.com"
  type    = "A"
  ttl     = 300
  records = [aws_eip.app.public_ip]
}