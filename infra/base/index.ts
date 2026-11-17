import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

// Register the safety transform before creating any resources.
pulumi.runtime.registerResourceTransform(a => a.type === 'aws:rds/instance:Instance'
  ? {props: {...a.props, deletionProtection: false, skipFinalSnapshot: true}, opts: a.opts} : undefined);
// Community LocalStack lacks Budgets; keep the required definition without claiming a deployed alert.
const budget = new pulumi.Config('hw31').getBoolean('skipUnsupportedBudget') ? undefined : new aws.budgets.Budget('monthly', {
  budgetType: 'COST', timeUnit: 'MONTHLY', limitAmount: '5', limitUnit: 'USD',
  notifications: [{notificationType: 'ACTUAL', comparisonOperator: 'GREATER_THAN',
    threshold: 20, thresholdType: 'PERCENTAGE', subscriberEmailAddresses: ['student@example.com']}],
});
// Every network resource depends transitively on the budget.
const vpc = new aws.ec2.Vpc('network', {cidrBlock: '10.231.0.0/16', enableDnsHostnames: true}, {dependsOn: budget ? [budget] : []});
const igw = new aws.ec2.InternetGateway('internet', {vpcId: vpc.id});
const publicTable = new aws.ec2.RouteTable('public', {vpcId: vpc.id,
  routes: [{cidrBlock: '0.0.0.0/0', gatewayId: igw.id}]});
const privateTable = new aws.ec2.RouteTable('private', {vpcId: vpc.id});
const publicSubnets: aws.ec2.Subnet[] = [];
const privateSubnets: aws.ec2.Subnet[] = [];
for (const [i, az] of ['eu-central-1a', 'eu-central-1b'].entries()) {
  for (const kind of ['public', 'private']) {
    const subnet = new aws.ec2.Subnet(`${kind}-${i}`, {vpcId: vpc.id, availabilityZone: az,
      cidrBlock: `10.231.${i + (kind === 'public' ? 0 : 10)}.0/24`, mapPublicIpOnLaunch: false});
    (kind === 'public' ? publicSubnets : privateSubnets).push(subnet);
    new aws.ec2.RouteTableAssociation(`${kind}-${i}`, {subnetId: subnet.id,
      routeTableId: kind === 'public' ? publicTable.id : privateTable.id});
  }
}
const albSg = new aws.ec2.SecurityGroup('alb', {vpcId: vpc.id,
  // Public HTTP is the exercise's ALB entry point. Lambda invocation uses IAM, no egress port.
  ingress: [{protocol: 'tcp', fromPort: 80, toPort: 80, cidrBlocks: ['0.0.0.0/0']}], egress: []});
const dbSg = new aws.ec2.SecurityGroup('database', {vpcId: vpc.id,
  // PostgreSQL accepts only VPC clients, never public Internet traffic.
  ingress: [{protocol: 'tcp', fromPort: 5432, toPort: 5432, cidrBlocks: ['10.231.0.0/16']}], egress: []});
const oidc = new aws.iam.OpenIdConnectProvider('github', {
  url: 'https://token.actions.githubusercontent.com', clientIdLists: ['sts.amazonaws.com'],
  thumbprintLists: ['6938fd4d98bab03faadb97b34396831e3780aea1'],
}, {dependsOn: budget ? [budget] : []});
const role = new aws.iam.Role('teardown', {assumeRolePolicy: oidc.arn.apply(arn => JSON.stringify({Version: '2012-10-17', Statement: [{
  Effect: 'Allow', Principal: {Federated: arn}, Action: 'sts:AssumeRoleWithWebIdentity',
  Condition: {StringEquals: {'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com'},
    StringLike: {'token.actions.githubusercontent.com:sub': 'repo:AndreyKarpenko/robot_dreams:ref:refs/heads/hw-31'}},
}]}))});
// Document only: LocalStack does not enforce this policy. No real AWS role is used by this lane.
new aws.iam.RolePolicy('teardown', {role: role.id, policy: JSON.stringify({Version: '2012-10-17', Statement: [
  {Effect: 'Allow', Action: ['ec2:DescribeVpcs','ec2:DescribeSubnets','ec2:DescribeRouteTables',
    'ec2:DescribeSecurityGroups','ec2:DescribeNatGateways','ec2:DescribeAddresses',
    'rds:DescribeDBInstances','elasticloadbalancing:DescribeLoadBalancers','tag:GetResources'], Resource: '*'},
  {Effect: 'Allow', Action: ['rds:DeleteDBInstance','rds:DeleteDBSubnetGroup',
    'elasticloadbalancing:DeleteLoadBalancer','elasticloadbalancing:DeleteListener',
    'elasticloadbalancing:DeleteTargetGroup','elasticloadbalancing:DeregisterTargets',
    'ec2:DeleteNatGateway','ec2:ReleaseAddress','lambda:DeleteFunction','lambda:RemovePermission'], Resource: '*',
    Condition: {StringEquals: {'aws:ResourceTag/Project': 'nodejs-pro-hw31'}}},
]})});
export const vpcId = vpc.id;
export const publicSubnetIds = publicSubnets.map(s => s.id);
export const privateSubnetIds = privateSubnets.map(s => s.id);
export const albSecurityGroupId = albSg.id;
export const dbSecurityGroupId = dbSg.id;
export const roleArn = role.arn;
export const roleName = role.name;
