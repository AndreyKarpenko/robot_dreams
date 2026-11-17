"""Collect actual LocalStack responses; never use this as AWS IAM evidence."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
OUT = ROOT / 'evidence'
OUT.mkdir(exist_ok=True)
COMPOSE = ['docker', 'compose', '-f', 'infra/hw31/compose.yaml']

def aws(*args, region='eu-central-1', key='test'):
    raw = subprocess.check_output(COMPOSE + ['exec', '-T', '-e', f'AWS_ACCESS_KEY_ID={key}',
        '-e', 'AWS_SECRET_ACCESS_KEY=test', 'localstack', 'awslocal', '--region', region, *args], text=True, stderr=subprocess.STDOUT)
    return json.loads(raw) if raw.strip() else {}

def write(name, values):
    text = ''.join(f'{k}={v}\n' for k, v in values.items())
    (OUT / name).write_text(text)
    print(text, end='')

mode = sys.argv[1]
if mode == 'base':
    raw = subprocess.check_output(['pulumi', '-C', 'infra/base', 'stack', 'export', '--stack', 'local'], text=True)
    (OUT / 'base-state.json').write_text(raw)
    state = json.loads(raw)
    resources = state['deployment']['resources']
    outputs = next(r['outputs'] for r in resources if r['type'] == 'pulumi:pulumi:Stack')
    vpc = outputs['vpcId']
    subnets = aws('ec2', 'describe-subnets', '--filters', f'Name=vpc-id,Values={vpc}')['Subnets']
    private = outputs['privateSubnetIds']
    routes = aws('ec2', 'describe-route-tables', '--filters', f'Name=vpc-id,Values={vpc}')['RouteTables']
    private_tables = [t for t in routes if any(a.get('SubnetId') in private for a in t['Associations'])]
    assert len({a.get('SubnetId') for t in private_tables for a in t['Associations'] if a.get('SubnetId') in private}) == 2
    tags = aws('resourcegroupstaggingapi', 'get-resources', '--tag-filters', 'Key=Project,Values=nodejs-pro-hw31')['ResourceTagMappingList']
    write('base.txt', {'vpc-id': vpc, 'public-subnets': len(outputs['publicSubnetIds']), 'private-subnets': len(private),
        'subnet-azs': len({s['AvailabilityZone'] for s in subnets}),
        'private-default-route': sum(r.get('DestinationCidrBlock') == '0.0.0.0/0' for t in private_tables for r in t['Routes']),
        'security-groups': len(aws('ec2', 'describe-security-groups', '--filters', f'Name=vpc-id,Values={vpc}')['SecurityGroups']) - 1,
        'tagged-resources': len(tags)})
    role_name = outputs['roleName']
    role = aws('iam', 'get-role', '--role-name', role_name)
    names = aws('iam', 'list-role-policies', '--role-name', role_name)['PolicyNames']
    role['PermissionPolicies'] = [aws('iam', 'get-role-policy', '--role-name', role_name, '--policy-name', n)['PolicyDocument'] for n in names]
    (OUT / 'iam.json').write_text(json.dumps(role, indent=2)+'\n')
elif mode == 'iam':
    started = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    suffix = str(int(time.time()))
    username, bucket = 'deny-'+suffix, 'hw31-iam-'+suffix
    aws('iam', 'create-user', '--user-name', username)
    try:
        aws('iam', 'put-user-policy', '--user-name', username, '--policy-name', 'deny-all', '--policy-document',
            json.dumps({'Version': '2012-10-17', 'Statement': [{'Effect': 'Deny', 'Action': '*', 'Resource': '*'}]}))
        key = aws('iam', 'create-access-key', '--user-name', username)['AccessKey']
        aws('s3api', 'create-bucket', '--bucket', bucket, '--create-bucket-configuration', 'LocationConstraint=eu-central-1', key=key['AccessKeyId'])
        response = aws('s3api', 'put-object', '--bucket', bucket, '--key', 'proof', '--body', '/etc/hostname', key=key['AccessKeyId'])
        assert response.get('ETag')
        fake = aws('s3api', 'get-object', '--bucket', bucket, '--key', 'proof', '/tmp/hw31-iam-object', key='TOTALLY_FAKE_KEY_12345')
        assert fake.get('ContentLength', 0) > 0
        logs = subprocess.check_output(COMPOSE + ['logs', '--since', started, 'localstack'], text=True, stderr=subprocess.STDOUT)
        (OUT / 'localstack-iam.log').write_text(logs)
        import re
        count = sum(bool(re.search(r'accessdenied|explicit.?deny|implicit.?deny|enforc', line, re.I)) for line in logs.splitlines())
        write('localstack-iam.txt', {'deny-all': 200, 'fake-key': 200, 'enforce-iam-log-lines': count})
    finally:
        aws('s3api', 'delete-object', '--bucket', bucket, '--key', 'proof')
        aws('s3api', 'delete-bucket', '--bucket', bucket)
        aws('iam', 'delete-access-key', '--user-name', username, '--access-key-id', key['AccessKeyId'])
        aws('iam', 'delete-user-policy', '--user-name', username, '--policy-name', 'deny-all')
        aws('iam', 'delete-user', '--user-name', username)
elif mode == 'teardown':
    left = sum(sum(r['type'].startswith('aws:') for r in json.loads(Path(f'/tmp/hw31-{n}-state.json').read_text())['deployment'].get('resources', [])) for n in ['base','demo'])
    totals = dict.fromkeys(['state-resources-left','tagged-resources-left','rds-left','alb-left','nat-left','eip-left'], 0)
    totals['state-resources-left'] = left
    for region in ['eu-central-1', 'us-east-1']:
        checks = {
            'tagged-resources-left': ('resourcegroupstaggingapi','get-resources','--tag-filters','Key=Project,Values=nodejs-pro-hw31','--query','length(ResourceTagMappingList)'),
            'rds-left': ('rds','describe-db-instances','--query','length(DBInstances)'),
            'alb-left': ('elbv2','describe-load-balancers','--query','length(LoadBalancers)'),
            'nat-left': ('ec2','describe-nat-gateways','--filter','Name=state,Values=available','--query','length(NatGateways)'),
            'eip-left': ('ec2','describe-addresses','--query','length(Addresses)'),
        }
        for k, args in checks.items():
            # Some APIs are license-gated on this lane: never interpret an error as zero.
            try:
                value = int(aws(*args, region=region))
                if k in totals:
                    totals[k] += value
            except subprocess.CalledProcessError as error:
                message = error.output or ''
                if k not in ['rds-left', 'alb-left'] or 'not included' not in message:
                    raise
                print(f'check-unavailable: {region} {k}: {message.strip()}')
                totals.pop(k, None)
    write('demos.txt', totals)
    assert not any(totals.values()), totals
