import os
from dotenv import load_dotenv
load_dotenv('.env')
import psycopg2

conn = psycopg2.connect(os.getenv('DATABASE_URL'))
cur = conn.cursor()

# Check if users table exists
cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name")
tables = cur.fetchall()
print('=== Tables ===')
for t in tables:
    print(t[0])

print()
print('=== Users ===')
try:
    cur.execute('SELECT * FROM users')
    rows = cur.fetchall()
    print(f'{len(rows)} rows')
    for r in rows:
        print(r)
except Exception as e:
    print('ERROR:', e)

conn.close()
