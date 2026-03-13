"""
seed_admin.py — Run once to grant 'admin' permission to a role.

Usage (from backend/):
    python seed_admin.py                        # lists roles and prompts
    python seed_admin.py --role admin           # grant to role named 'admin'
    python seed_admin.py --role-id 1            # grant to role_id 1

The script is idempotent – running it multiple times is safe.
"""
import sys
import os
import argparse
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()

_AUTH_DB_CONN = os.getenv(
    "AUTH_DB_CONNECTION",
    "mssql+pyodbc://@apo-sql-dev/ApoAsset_JM?driver=ODBC+Driver+17+for+SQL+Server&Trusted_Connection=yes",
)

engine = create_engine(_AUTH_DB_CONN)


def list_roles():
    with engine.connect() as conn:
        result = conn.execute(text("SELECT role_id, role_name FROM roles ORDER BY role_id"))
        return result.fetchall()


def get_role_permissions(role_id):
    with engine.connect() as conn:
        result = conn.execute(
            text("SELECT permission_name FROM role_permissions WHERE role_id = :rid ORDER BY permission_name"),
            {"rid": role_id},
        )
        return [r[0] for r in result.fetchall()]


def grant_admin(role_id):
    with engine.connect() as conn:
        # Check if already present
        existing = conn.execute(
            text("SELECT 1 FROM role_permissions WHERE role_id = :rid AND permission_name = 'admin'"),
            {"rid": role_id},
        ).fetchone()
        if existing:
            print(f"  ✓ 'admin' permission already exists for role_id={role_id}")
            return
        conn.execute(
            text("INSERT INTO role_permissions (role_id, permission_name) VALUES (:rid, 'admin')"),
            {"rid": role_id},
        )
        conn.commit()
    print(f"  ✓ Granted 'admin' permission to role_id={role_id}")


def main():
    parser = argparse.ArgumentParser(description="Grant 'admin' permission to a dashboard role")
    parser.add_argument("--role",    type=str, help="Role name to grant admin permission to")
    parser.add_argument("--role-id", type=int, dest="role_id", help="Role ID to grant admin permission to")
    args = parser.parse_args()

    print("── Dashboard Admin Permission Seeder ──────────────────────────")
    print(f"Database: {_AUTH_DB_CONN[:60]}…\n")

    # List all roles
    roles = list_roles()
    print("Existing roles:")
    for rid, rname in roles:
        perms = get_role_permissions(rid)
        admin_flag = " ← has 'admin'" if "admin" in perms else ""
        print(f"  [{rid}] {rname}  ({', '.join(perms) if perms else 'no permissions'}){admin_flag}")
    print()

    # Resolve target role
    target_id = None

    if args.role_id:
        match = [r for r in roles if r[0] == args.role_id]
        if not match:
            print(f"Error: role_id={args.role_id} not found."); sys.exit(1)
        target_id = args.role_id
        print(f"Targeting role_id={args.role_id} ({match[0][1]})")
    elif args.role:
        match = [r for r in roles if r[1].lower() == args.role.lower()]
        if not match:
            print(f"Error: no role named '{args.role}'."); sys.exit(1)
        target_id = match[0][0]
        print(f"Targeting role_id={target_id} ({match[0][1]})")
    else:
        # Interactive prompt
        raw = input("Enter the role_id that should receive 'admin' access: ").strip()
        try:
            target_id = int(raw)
        except ValueError:
            print("Invalid input. Exiting."); sys.exit(1)
        if not any(r[0] == target_id for r in roles):
            print(f"role_id={target_id} not found."); sys.exit(1)

    grant_admin(target_id)
    print("\nDone. Log out and back in to pick up the new permission.")


if __name__ == "__main__":
    main()
