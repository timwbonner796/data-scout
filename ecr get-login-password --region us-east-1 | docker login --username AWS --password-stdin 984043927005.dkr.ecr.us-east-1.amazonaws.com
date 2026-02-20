{
    "repository": {
        "repositoryArn": "arn:aws:ecr:us-east-1:984043927005:repository/data-scout",
        "registryId": "984043927005",
        "repositoryName": "data-scout",
        "repositoryUri": "984043927005.dkr.ecr.us-east-1.amazonaws.com/data-scout",
        "createdAt": "2026-02-19T16:50:32.504000-06:00",
        "imageTagMutability": "MUTABLE",
        "imageScanningConfiguration": {
            "scanOnPush": false
        },
        "encryptionConfiguration": {
            "encryptionType": "AES256"
        }
    }
}
