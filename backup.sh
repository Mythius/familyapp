#!/bin/bash

# Load environment variables from .env file
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Parse .env file manually to handle special characters
export $(grep -v '^#' "$SCRIPT_DIR/.env" | sed 's/\r$//' | while IFS='=' read -r key value; do
    # Remove surrounding quotes if present
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    echo "$key=$value"
done)

# Configuration
DATABASE_NAME="family_db"
BACKUP_DIR="$SCRIPT_DIR/backups"
DATE=$(date +%Y-%m-%d_%H-%M-%S)
BACKUP_FILE="family_db_backup_$DATE.sql"
GDRIVE_FOLDER="FamilyApp_Backups"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

echo "Starting database backup..."

# Run mysqldump locally using config file to avoid password issues
MYSQL_CONFIG=$(mktemp)
chmod 600 "$MYSQL_CONFIG"
cat > "$MYSQL_CONFIG" << EOF
[mysqldump]
user=$DB_USER
password=$DB_PASS
EOF

mysqldump --defaults-extra-file="$MYSQL_CONFIG" -h localhost "$DATABASE_NAME" > "$BACKUP_DIR/$BACKUP_FILE"
DUMP_RESULT=$?

# Remove temp config file
rm -f "$MYSQL_CONFIG"

if [ $DUMP_RESULT -eq 0 ]; then
    echo "Database backup created: $BACKUP_DIR/$BACKUP_FILE"

    # Compress the backup
    gzip "$BACKUP_DIR/$BACKUP_FILE"
    BACKUP_FILE="$BACKUP_FILE.gz"
    echo "Backup compressed: $BACKUP_DIR/$BACKUP_FILE"

    # Upload to Google Drive
    echo "Uploading to Google Drive..."

    # Check if gdrive folder exists, create if not
    FOLDER_ID=$(gdrive files list --query "name = '$GDRIVE_FOLDER' and mimeType = 'application/vnd.google-apps.folder'" --skip-header | head -1 | awk '{print $1}')

    if [ -z "$FOLDER_ID" ]; then
        echo "Creating Google Drive folder: $GDRIVE_FOLDER"
        FOLDER_ID=$(gdrive files mkdir "$GDRIVE_FOLDER" | awk '{print $2}')
    fi

    # Upload the backup file
    gdrive files upload --parent "$FOLDER_ID" "$BACKUP_DIR/$BACKUP_FILE"

    if [ $? -eq 0 ]; then
        echo "Backup uploaded to Google Drive successfully!"

        # Optional: Remove local backup after successful upload (uncomment to enable)
        # rm "$BACKUP_DIR/$BACKUP_FILE"
        # echo "Local backup removed."
    else
        echo "Error uploading to Google Drive"
        exit 1
    fi
else
    echo "Error creating database backup"
    exit 1
fi

echo "Backup complete!"
