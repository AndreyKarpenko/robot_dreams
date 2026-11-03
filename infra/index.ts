import * as pulumi from '@pulumi/pulumi';
import * as k8s from '@pulumi/kubernetes';

/**
 * Validate vault-backed env vars BEFORE any cluster call.
 * Criterion 5 unsets them one-by-one and checks that the name appears
 * in the error output with a non-zero exit.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `${name} is required (value comes from the secrets store / сховище #11)`,
    );
  }
  return value;
}

// PULUMI_CONFIG_PASSPHRASE is also consumed by the CLI for state encryption;
// we still name it here so a missing value fails inside the program too.
requireEnv('PULUMI_CONFIG_PASSPHRASE');
const appDbPassword = requireEnv('APP_DB_PASSWORD');

const cfg = new pulumi.Config();
const image = cfg.get('image') ?? 'marketplace-api:hw28';
const replicas = cfg.getNumber('replicas') ?? 2;
const drainMs = cfg.getNumber('drainMs') ?? 5000;
const warmupMs = cfg.getNumber('warmupMs') ?? 4000;
const rev = cfg.get('rev') ?? '1';
const namespaceName = cfg.get('namespace') ?? 'marketplace';
const appLabels = { app: 'marketplace-api' };

// Grace must exceed preStop sleep + app drain, else SIGKILL mid-drain.
const preStopSleepSeconds = 8;
const terminationGracePeriodSeconds =
  preStopSleepSeconds + Math.ceil(drainMs / 1000) + 10;

const ns = new k8s.core.v1.Namespace('marketplace', {
  metadata: { name: namespaceName },
});

// stringData breaks idempotency (write-only). Use base64 data instead.
const appSecret = new k8s.core.v1.Secret(
  'marketplace-app',
  {
    metadata: {
      name: 'marketplace-app',
      namespace: ns.metadata.name,
    },
    type: 'Opaque',
    data: {
      APP_DB_PASSWORD: Buffer.from(appDbPassword, 'utf8').toString('base64'),
    },
  },
  { dependsOn: [ns] },
);

const appLabelsMeta = {
  ...appLabels,
  rev,
};

const deployment = new k8s.apps.v1.Deployment(
  'marketplace-api',
  {
    metadata: {
      name: 'marketplace-api',
      namespace: ns.metadata.name,
      labels: appLabels,
    },
    spec: {
      // Kept on purpose: kind has no metrics-server, so HPA will not scale.
      // In a real cluster with metrics-server this field is a ownership conflict
      // with the HPA — see README § Kubernetes.
      replicas,
      selector: { matchLabels: appLabels },
      strategy: {
        type: 'RollingUpdate',
        rollingUpdate: {
          maxUnavailable: 0,
          maxSurge: 1,
        },
      },
      template: {
        metadata: {
          labels: appLabelsMeta,
          annotations: {
            // Changing REV forces a rollout even when the image tag is unchanged.
            'marketplace.io/rev': rev,
          },
        },
        spec: {
          terminationGracePeriodSeconds,
          securityContext: {
            runAsNonRoot: true,
            runAsUser: 65532,
            runAsGroup: 65532,
            fsGroup: 65532,
          },
          containers: [
            {
              name: 'api',
              image,
              imagePullPolicy: 'IfNotPresent',
              ports: [{ name: 'http', containerPort: 3000 }],
              env: [
                { name: 'PORT', value: '3000' },
                { name: 'WARMUP_MS', value: String(warmupMs) },
                { name: 'DRAIN_MS', value: String(drainMs) },
                {
                  name: 'APP_DB_PASSWORD',
                  valueFrom: {
                    secretKeyRef: {
                      name: 'marketplace-app',
                      key: 'APP_DB_PASSWORD',
                    },
                  },
                },
              ],
              // Sleep BEFORE SIGTERM so kube-proxy drops Endpoints first.
              // Distroless has no shell — use the native Pod sleep action (1.29+).
              lifecycle: {
                preStop: {
                  sleep: { seconds: preStopSleepSeconds },
                },
              },
              readinessProbe: {
                httpGet: { path: '/readyz', port: 'http' },
                periodSeconds: 1,
                failureThreshold: 1,
                successThreshold: 1,
                timeoutSeconds: 1,
              },
              livenessProbe: {
                httpGet: { path: '/healthz', port: 'http' },
                periodSeconds: 10,
                failureThreshold: 3,
                timeoutSeconds: 1,
              },
              startupProbe: {
                httpGet: { path: '/healthz', port: 'http' },
                periodSeconds: 1,
                failureThreshold: 30,
                timeoutSeconds: 1,
              },
              resources: {
                requests: { cpu: '50m', memory: '64Mi' },
                limits: { cpu: '500m', memory: '256Mi' },
              },
              securityContext: {
                allowPrivilegeEscalation: false,
                readOnlyRootFilesystem: true,
                runAsNonRoot: true,
                runAsUser: 65532,
                capabilities: { drop: ['ALL'] },
              },
            },
          ],
        },
      },
    },
  },
  { dependsOn: [appSecret] },
);

const service = new k8s.core.v1.Service(
  'marketplace-api',
  {
    metadata: {
      name: 'marketplace-api',
      namespace: ns.metadata.name,
      labels: appLabels,
    },
    spec: {
      type: 'NodePort',
      selector: appLabels,
      ports: [
        {
          name: 'http',
          port: 80,
          targetPort: 3000,
          nodePort: 30080,
        },
      ],
    },
  },
  { dependsOn: [deployment] },
);

// minAvailable < replicas so one disruption is allowed (drain / eviction).
const pdb = new k8s.policy.v1.PodDisruptionBudget(
  'marketplace-api',
  {
    metadata: {
      name: 'marketplace-api',
      namespace: ns.metadata.name,
      labels: appLabels,
    },
    spec: {
      minAvailable: 1,
      selector: { matchLabels: appLabels },
    },
  },
  { dependsOn: [deployment] },
);

const hpa = new k8s.autoscaling.v2.HorizontalPodAutoscaler(
  'marketplace-api',
  {
    metadata: {
      name: 'marketplace-api',
      namespace: ns.metadata.name,
      labels: appLabels,
    },
    spec: {
      scaleTargetRef: {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        name: 'marketplace-api',
      },
      minReplicas: 2,
      maxReplicas: 4,
      metrics: [
        {
          type: 'Resource',
          resource: {
            name: 'cpu',
            target: {
              type: 'Utilization',
              averageUtilization: 70,
            },
          },
        },
      ],
    },
  },
  { dependsOn: [deployment] },
);

export const namespace = ns.metadata.name;
export const deploymentName = deployment.metadata.name;
export const serviceName = service.metadata.name;
export const serviceNodePort = service.spec.ports[0].nodePort;
export const pdbName = pdb.metadata.name;
export const hpaName = hpa.metadata.name;
export const imageRef = image;
export const revision = rev;
