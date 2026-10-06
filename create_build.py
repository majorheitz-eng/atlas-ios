import os, json

eas_build_status = os.popen('eas status --json').read()
eas_build_status = json.loads(eas_build_status)

if eas_build_status['status'] == 'completed':
    build_id = eas_build_status['builds'][0]['id']
    print(f"Build ID: {build_id}")
