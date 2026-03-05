"""
Feedback database functions for storing and retrieving user feedback.
Uses the dev_engine (Apoasset_Common) from the shared DatabaseGateway.
"""

from sqlalchemy import text
from datetime import datetime
import pandas as pd
import logging

logger = logging.getLogger(__name__)


def create_feedback_table(engine):
    """
    Create the user_feedback table if it doesn't exist.
    """
    create_table_query = """
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='user_feedback' AND xtype='U')
    CREATE TABLE user_feedback (
        id INT IDENTITY(1,1) PRIMARY KEY,
        timestamp DATETIME NOT NULL DEFAULT GETDATE(),
        username VARCHAR(255),
        page VARCHAR(255) NOT NULL,
        feedback_type VARCHAR(50) NOT NULL,
        feedback_text VARCHAR(MAX) NOT NULL,
        status VARCHAR(50) DEFAULT 'new',
        CONSTRAINT CHK_feedback_type CHECK (feedback_type IN ('Bug', 'Feature Request', 'General Feedback', 'Other')),
        CONSTRAINT CHK_status CHECK (status IN ('new', 'reviewed', 'resolved', 'closed'))
    )
    """
    try:
        with engine.connect() as conn:
            conn.execute(text(create_table_query))
            conn.commit()
        logger.info("✓ Feedback table ready")
        return True
    except Exception as e:
        logger.error(f"Error creating feedback table: {e}")
        return False


def insert_feedback(engine, username: str, page: str, feedback_type: str, feedback_text: str) -> bool:
    """
    Insert a new feedback record into the database.

    Returns True on success, False otherwise.
    """
    insert_query = """
    INSERT INTO user_feedback (username, page, feedback_type, feedback_text, timestamp)
    VALUES (:username, :page, :feedback_type, :feedback_text, :timestamp)
    """
    try:
        with engine.connect() as conn:
            conn.execute(
                text(insert_query),
                {
                    "username": username,
                    "page": page,
                    "feedback_type": feedback_type,
                    "feedback_text": feedback_text,
                    "timestamp": datetime.now(),
                },
            )
            conn.commit()
        logger.info(f"✓ Feedback inserted from {username} on page '{page}'")
        return True
    except Exception as e:
        logger.error(f"Error inserting feedback: {e}")
        return False


def get_all_feedback(engine, status: str = None) -> pd.DataFrame:
    """
    Retrieve feedback records, optionally filtered by status.
    """
    if status:
        query = "SELECT * FROM user_feedback WHERE status = :status ORDER BY timestamp DESC"
        params = {"status": status}
    else:
        query = "SELECT * FROM user_feedback ORDER BY timestamp DESC"
        params = {}

    try:
        with engine.connect() as conn:
            df = pd.read_sql(text(query), conn, params=params)
        return df
    except Exception as e:
        logger.error(f"Error retrieving feedback: {e}")
        return pd.DataFrame()
