import { useEffect, useMemo, useState } from 'react';
import { ConnectorConfig, ConnectorState } from '@packages/connectors/base';
import { ConnectorManager } from '@packages/connectors/manager';
import { RestConnector } from '@packages/connectors/built-in/rest';
import { GrpcConnector } from '@packages/connectors/built-in/grpc';
import { WebhookConnector } from '@packages/connectors/built-in/webhook';
import { FileExportConnector } from '@packages/connectors/built-in/fileExport';
import { PlanConfig } from '@packages/types/shared';

export function useConnectors(initialConfig?: PlanConfig) {
  const manager = useMemo(() => {
    const next = new ConnectorManager();
    next.register(new RestConnector());
    next.register(new GrpcConnector());
    next.register(new WebhookConnector());
    next.register(new FileExportConnector());
    return next;
  }, []);

  useEffect(() => {
    manager.hydrate(initialConfig?.connectors);
  }, [manager, initialConfig?.connectors]);

  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);

  const connectors = useMemo<ConnectorState[]>(() => manager.getAll(), [manager, version]);

  const setConnectorEnabled = (id: string, enabled: boolean) => {
    manager.setEnabled(id, enabled);
    bump();
  };

  const updateConnectorConfig = (id: string, config: ConnectorConfig) => {
    manager.setConfig(id, config);
    bump();
  };

  const testConnector = async (id: string) => {
    const result = await manager.test(id);
    bump();
    return result;
  };

  return {
    manager,
    connectors,
    setConnectorEnabled,
    updateConnectorConfig,
    testConnector,
    exportConnectorConfig: () => manager.exportConfig()
  };
}
