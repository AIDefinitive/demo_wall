export type ServiceState = {
  serviceName: string;
  serviceVersion: string;
  serviceNamespace: string;
  environment: string;
};

export const serviceState: ServiceState = {
  serviceName: "demo-wall",
  serviceVersion: "0.1.0",
  serviceNamespace: "demo-wall",
  environment: "local",
};
