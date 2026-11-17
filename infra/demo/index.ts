import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
pulumi.runtime.registerResourceTransform(a => a.type === 'aws:rds/instance:Instance'
  ? {props: {...a.props, deletionProtection: false, skipFinalSnapshot: true}, opts: a.opts} : undefined);
const base = new pulumi.StackReference('organization/hw31-base/local');
const config = new pulumi.Config('hw31');
const group = new aws.rds.SubnetGroup('database', {subnetIds: base.getOutput('privateSubnetIds')});
const db = new aws.rds.Instance('postgres', {engine: 'postgres', instanceClass: 'db.t4g.micro',
  multiAz: true, storageType: 'gp3', allocatedStorage: 20, storageEncrypted: true,
  backupRetentionPeriod: 1, dbSubnetGroupName: group.name,
  vpcSecurityGroupIds: [base.getOutput('dbSecurityGroupId')], publiclyAccessible: false,
  username: 'student', password: config.getSecret('dbPassword') ?? pulumi.secret('LocalStack-only-password-31'),
  monitoringInterval: 0, performanceInsightsEnabled: false,
});
const alb = new aws.lb.LoadBalancer('http', {internal: false, loadBalancerType: 'application',
  subnets: base.getOutput('publicSubnetIds'), securityGroups: [base.getOutput('albSecurityGroupId')]});
const target = new aws.lb.TargetGroup('lambda', {targetType: 'lambda', healthCheck: {enabled: true, interval: 35}});
if (!config.getBoolean('skipLocalLambda')) {
  const role = new aws.iam.Role('lambda', {assumeRolePolicy: JSON.stringify({Version: '2012-10-17',
    Statement: [{Effect: 'Allow', Principal: {Service: 'lambda.amazonaws.com'}, Action: 'sts:AssumeRole'}]})});
  const fn = new aws.lambda.Function('http', {role: role.arn, runtime: 'nodejs22.x', handler: 'index.handler',
    code: new pulumi.asset.AssetArchive({'index.js': new pulumi.asset.StringAsset(
      'exports.handler=async()=>({statusCode:200,statusDescription:"200 OK",isBase64Encoded:false,headers:{"content-type":"application/json"},body:JSON.stringify({ok:true})});')}),
  });
  const permission = new aws.lambda.Permission('alb', {action: 'lambda:InvokeFunction', function: fn.name,
    principal: 'elasticloadbalancing.amazonaws.com', sourceArn: target.arn});
  new aws.lb.TargetGroupAttachment('lambda', {targetGroupArn: target.arn, targetId: fn.arn}, {dependsOn: permission});
}
new aws.lb.Listener('http', {loadBalancerArn: alb.arn, port: 80, protocol: 'HTTP',
  defaultActions: [{type: 'forward', targetGroupArn: target.arn}]});
if (config.getBoolean('withNat')) {
  const ip = new aws.ec2.Eip('nat', {domain: 'vpc'});
  new aws.ec2.NatGateway('exercise', {allocationId: ip.id, subnetId: base.getOutput('publicSubnetIds').apply(ids => ids[0])});
}
export const dbIdentifier = db.identifier;
export const albDns = alb.dnsName;
export const targetGroupArn = target.arn;
