import { useState, useEffect, useImperativeHandle, forwardRef, useCallback } from 'react';
import { PlanConfig, CustomField, DropdownOption, PlanMetadata, Task } from '@packages/types/shared';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Copy, AlertCircle, Check } from 'lucide-react';
import { UI_MESSAGES } from '@packages/types/messages';
import { Button } from '@packages/ui/Button';
import { Modal } from '@packages/ui/Modal';
import { ConnectorState } from '@packages/connectors/base';
import { PlanMetadataFields } from './PlanMetadataFields';
import { FieldCard } from './FieldCard';
import { MigrationDialog, MigrationStep } from './MigrationDialog';
import { useHotkey } from '../../../lib/useHotkey';
import { usePlan, useConfirm } from '@packages/storage/PlanContext';

export interface PlanSettingsActions {
  save: () => void;
  reset: () => void;
  unlist: () => void;
  isDirty: () => boolean;
}

type DeletionStep = {
  type: 'field';
  field: CustomField;
  taskCount: number;
} | {
  type: 'option';
  field: CustomField;
  option: DropdownOption;
  taskCount: number;
};

export const PlanSettings = forwardRef<PlanSettingsActions>(
  (_, ref) => {
    const { 
      config: initialConfig, 
      metadata: initialMetadata, 
      tasks, 
      saveSettings: onSave, 
      unlistCurrentPlan: onUnlist,
      connectors,
      setConnectorEnabled,
      updateConnectorConfig,
      testConnector,
      exportConnectorConfig,
    } = usePlan();

    const { confirm: confirmRequest } = useConfirm();

    // We combine them internally for the form state
    const [formData, setFormData] = useState<{ config: PlanConfig, metadata: PlanMetadata }>(() => ({
      config: {
        ...initialConfig,
        customFields: initialConfig.customFields
          .filter(f => typeof f === 'object' && f !== null && f.id && f.label && f.type)
          .map(f => ({ 
            id: f.id,
            label: f.label,
            type: f.type,
            options: Array.isArray(f.options) 
              ? f.options.filter(opt => typeof opt === 'object' && opt !== null && opt.id && opt.label).map(opt => ({ ...opt }))
              : undefined
          }))
      },
      metadata: { ...initialMetadata }
    }));

    const [error, setError] = useState<string | null>(null);
    const [errorFields, setErrorFields] = useState<number[]>([]);
    const [showSuccess, setShowSuccess] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);
    const [connectorConfigDrafts, setConnectorConfigDrafts] = useState<Record<string, string>>({});
    const [connectorTests, setConnectorTests] = useState<Record<string, string>>({});
    
    // Migration states
    const [migrationQueue, setMigrationQueue] = useState<DeletionStep[]>([]);
    const [currentStepIndex, setCurrentStepIndex] = useState(-1);
    const [migrationTasks, setMigrationTasks] = useState<Task[]>(tasks);
    const [migrationTargetId, setMigrationTargetId] = useState<string>('clear');

    const resetFormData = useCallback(() => {
      setFormData({
        config: {
          ...initialConfig,
          customFields: initialConfig.customFields
            .filter(f => typeof f === 'object' && f !== null && f.id && f.label && f.type)
            .map(f => ({ 
              id: f.id,
              label: f.label,
              type: f.type,
              options: Array.isArray(f.options) 
                ? f.options.filter(opt => typeof opt === 'object' && opt !== null && opt.id && opt.label).map(opt => ({ ...opt }))
                : undefined
            }))
        },
        metadata: { ...initialMetadata }
      });
      setMigrationTasks(tasks);
      setError(null);
      setErrorFields([]);
      setMigrationQueue([]);
      setCurrentStepIndex(-1);
      setMigrationTargetId('clear');
      setConnectorConfigDrafts({});
      setConnectorTests({});
    }, [initialConfig, initialMetadata, tasks]);

    useEffect(() => {
      resetFormData();
    }, [resetFormData]);

    const isDirty = JSON.stringify(formData.config) !== JSON.stringify(initialConfig) || 
                    JSON.stringify(formData.metadata) !== JSON.stringify(initialMetadata);

/* -------------------------------------------------------------------------- */
/* Logic: Migration & Settlement                                            */
/* -------------------------------------------------------------------------- */

    /**
     * Detection Logic: Identifies fields or options that have been removed
     * in the current draft state but still exist in the persisted tasks.
     */
    const detectDeletions = useCallback(() => {
      const queue: DeletionStep[] = [];
      
      // Check for removed fields
      initialConfig.customFields.forEach(oldField => {
        const stillExists = formData.config.customFields.some(f => f.id === oldField.id);
        if (!stillExists) {
          const affectedCount = tasks.filter(t => t[oldField.id] !== undefined && t[oldField.id] !== '').length;
          if (affectedCount > 0) {
            queue.push({ type: 'field', field: oldField, taskCount: affectedCount });
          }
        } else if (oldField.type === 'select') {
          // Check for removed options in existing field
          const newField = formData.config.customFields.find(f => f.id === oldField.id);
          if (newField && newField.type === 'select' && oldField.options) {
            oldField.options.forEach(oldOpt => {
              const optExists = newField.options?.some(o => o.id === oldOpt.id);
              if (!optExists) {
                const affectedCount = tasks.filter(t => t[oldField.id] === oldOpt.id).length;
                if (affectedCount > 0) {
                  queue.push({ type: 'option', field: oldField, option: oldOpt, taskCount: affectedCount });
                }
              }
            });
          }
        }
      });

      return queue;
    }, [initialConfig.customFields, formData.config.customFields, tasks]);

    const finalizeSave = useCallback((finalTasks: Task[]) => {
      setError(null);
      setErrorFields([]);
      const nextConfig: PlanConfig = {
        ...formData.config,
        connectors: exportConnectorConfig()
      };
      onSave(nextConfig, formData.metadata, finalTasks);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    }, [onSave, formData.config, formData.metadata, exportConnectorConfig]);

    const handleSave = useCallback(() => {
      // Validation
      const fields = formData.config.customFields;
      // ... existing validation
      const labels = fields.map(f => f.label.trim().toLowerCase());
      
      const emptyLabelIndices: number[] = fields.map((f, i) => !f.label.trim() ? i : -1).filter(i => i !== -1);
      
      if (emptyLabelIndices.length > 0) {
        setError(UI_MESSAGES.ERRORS.FIELD_LABEL_EMPTY);
        setErrorFields(emptyLabelIndices);
        scrollToError(emptyLabelIndices[0]);
        setTimeout(() => { setError(null); setErrorFields([]); }, 3000);
        return;
      }

      const duplicateLabelIndices: number[] = [];
      labels.forEach((label, i) => {
        if (labels.indexOf(label) !== i) {
          labels.forEach((l, idx) => {
            if (l === label && !duplicateLabelIndices.includes(idx)) duplicateLabelIndices.push(idx);
          });
        }
      });

      if (duplicateLabelIndices.length > 0) {
        setError(UI_MESSAGES.ERRORS.FIELD_LABEL_DUPLICATE);
        setErrorFields([...new Set(duplicateLabelIndices)]);
        scrollToError(duplicateLabelIndices[0]);
        setTimeout(() => { setError(null); setErrorFields([]); }, 3000);
        return;
      }

      // Validate options for all select fields
      for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        if (field.type === 'select') {
          if (!field.options || field.options.length === 0) {
            setError(UI_MESSAGES.ERRORS.FIELD_OPTIONS_MIN(field.label));
            setErrorFields([i]);
            scrollToError(i);
            setTimeout(() => { setError(null); setErrorFields([]); }, 3000);
            return;
          }
          if (field.options.some(opt => !opt.label.trim())) {
            setError(UI_MESSAGES.ERRORS.FIELD_OPTIONS_EMPTY(field.label));
            setErrorFields([i]);
            scrollToError(i);
            setTimeout(() => { setError(null); setErrorFields([]); }, 3000);
            return;
          }
        }
      }

      // Deletion Detection
      const deletions = detectDeletions();
      if (deletions.length > 0) {
        setMigrationQueue(deletions);
        setCurrentStepIndex(0);
        setMigrationTasks(tasks);
        setMigrationTargetId('clear');
        return;
      }

      finalizeSave(tasks);
    }, [formData, tasks, detectDeletions, finalizeSave]);

    useHotkey('s', handleSave, { ctrlKey: true, metaKey: true });
    
    const resolveDeletion = () => {
      const step = migrationQueue[currentStepIndex];
      let nextTasks = [...migrationTasks];

      if (step.type === 'field') {
        // Hard delete field from all tasks
        nextTasks = nextTasks.map(t => {
          const newTask = { ...t };
          delete newTask[step.field.id];
          return newTask;
        });
      } else {
        // Migrate option
        nextTasks = nextTasks.map(t => {
          if (t[step.field.id] === step.option.id) {
            return {
              ...t,
              [step.field.id]: migrationTargetId === 'clear' ? '' : migrationTargetId
            };
          }
          return t;
        });
      }

      setMigrationTasks(nextTasks);
      
      if (currentStepIndex < migrationQueue.length - 1) {
        setCurrentStepIndex(currentStepIndex + 1);
        setMigrationTargetId('clear');
      } else {
        // All settled
        setMigrationQueue([]);
        setCurrentStepIndex(-1);
        finalizeSave(nextTasks);
      }
    };

    const scrollToError = (index: number) => {
      const el = document.getElementById(`field-container-${index}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };

    const handleUnlist = async () => {
      const confirmed = await confirmRequest({
        ...UI_MESSAGES.CONFIRMATIONS.REMOVE_PLAN,
        message: UI_MESSAGES.CONFIRMATIONS.REMOVE_PLAN.message(initialMetadata?.name)
      });
      if (confirmed) {
        onUnlist();
      }
    };

    const handleReset = useCallback(() => {
      resetFormData();
    }, [resetFormData]);

    useImperativeHandle(ref, () => ({
      save: handleSave,
      reset: handleReset,
      unlist: handleUnlist,
      isDirty: () => isDirty
    }));

/* -------------------------------------------------------------------------- */
/* Handlers: Sub-field Interactivity                                        */
/* -------------------------------------------------------------------------- */

    const handleAddField = () => {
      const id = crypto.randomUUID();
      const newField: CustomField = {
        id,
        label: 'New Field',
        type: 'text'
      };
      setFormData(prev => ({
        ...prev,
        config: {
          ...prev.config,
          customFields: [...prev.config.customFields, newField]
        }
      }));
    };

    const handleRemoveField = (index: number) => {
      setFormData(prev => ({
        ...prev,
        config: {
          ...prev.config,
          customFields: prev.config.customFields.filter((_, i) => i !== index)
        }
      }));
    };

    const handleUpdateField = (index: number, updates: Partial<CustomField>) => {
      setFormData(prev => {
        const nextFields = [...prev.config.customFields];
        nextFields[index] = { ...nextFields[index], ...updates };
        return { 
          ...prev, 
          config: { ...prev.config, customFields: nextFields } 
        };
      });
    };

    const handleImportConfig = async () => {
      try {
        let content = '';
        const vscodeApi = (window as any).vscode;
        if (vscodeApi?.postMessage) {
          content = await new Promise<string>((resolve, reject) => {
            const handler = (event: MessageEvent) => {
              if (event.data?.type !== 'importConfigFileSelected') return;
              window.removeEventListener('message', handler);
              if (!event.data.content) {
                const err = new Error('No file selected');
                (err as any).name = 'AbortError';
                reject(err);
                return;
              }
              resolve(event.data.content);
            };
            window.addEventListener('message', handler);
            vscodeApi.postMessage({ type: 'selectImportConfigFile' });
          });
        } else {
          const [fileHandle] = await (window as any).showOpenFilePicker({
            types: [{
              description: 'Plan InPlace Metadata (metadata.json)',
              accept: { 'application/json': ['.json'] }
            }],
            multiple: false
          });

          const file = await fileHandle.getFile();
          content = await file.text();
        }

        let parsed: any = null;
        try {
          parsed = JSON.parse(content);
        } catch (e) {
          setError(UI_MESSAGES.ERRORS.PARSE_FAILED);
          return;
        }

        if (parsed && parsed.config && Array.isArray(parsed.config.customFields)) {
          setFormData(prev => ({
            ...prev,
            config: {
              ...prev.config,
              customFields: parsed.config.customFields
            }
          }));
          setError(null);
        } else {
          setError(UI_MESSAGES.ERRORS.INVALID_CONFIG);
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          console.error('Import failed', e);
          setError(UI_MESSAGES.ERRORS.IMPORT_FAILED);
        }
      }
    };

    const handleContinueImport = async () => {
      setShowImportModal(false);
      await handleImportConfig();
    };

    const syncConnectorConfigInForm = useCallback(() => {
      setFormData(prev => ({
        ...prev,
        config: {
          ...prev.config,
          connectors: exportConnectorConfig()
        }
      }));
    }, [exportConnectorConfig]);

    const handleConnectorToggle = (id: string, enabled: boolean) => {
      setConnectorEnabled(id, enabled);
      syncConnectorConfigInForm();
    };

    const handleConnectorConfigChange = (id: string, value: string) => {
      setConnectorConfigDrafts(prev => ({ ...prev, [id]: value }));
    };

    const handleConnectorConfigBlur = (id: string) => {
      const raw = connectorConfigDrafts[id];
      if (raw === undefined) return;
      try {
        const parsed = raw.trim() ? JSON.parse(raw) : {};
        updateConnectorConfig(id, parsed);
        setConnectorTests(prev => ({ ...prev, [id]: '' }));
        syncConnectorConfigInForm();
      } catch {
        setConnectorTests(prev => ({ ...prev, [id]: 'Invalid JSON config' }));
      }
    };

    const handleConnectorTest = async (id: string) => {
      const result = await testConnector(id);
      setConnectorTests(prev => ({ ...prev, [id]: result.ok ? 'Connection OK' : result.message || 'Connection failed' }));
      syncConnectorConfigInForm();
    };

    const getConnectorStatus = (connector: ConnectorState) => {
      const testStatus = connectorTests[connector.id];
      if (testStatus) return testStatus;
      if (connector.lastSyncStatus === 'error') return connector.lastSyncMessage || 'Sync failed';
      if (connector.lastSyncStatus === 'success') return 'Last sync successful';
      return '';
    };

    return (
      <div className="h-full flex flex-col p-6 mx-auto space-y-8 overflow-y-auto relative">
        <AnimatePresence>
          {error && (
            <div className="fixed inset-0 pointer-events-none flex items-center justify-center z-50">
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="bg-priority-high text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 font-semibold text-[14px]"
              >
                <AlertCircle className="w-5 h-5" />
                {error}
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showSuccess && (
            <div className="fixed inset-0 pointer-events-none flex items-center justify-center z-50">
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="bg-accent text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 font-semibold text-[14px]"
              >
                <Check className="w-5 h-5" />
                {UI_MESSAGES.APP_TOASTS.SETTINGS_SAVED}
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <div className="space-y-6 pb-10 max-w-xl">
          {/* Section: Plan Information */}
          <PlanMetadataFields 
            metadata={formData.metadata}
            onChange={(updates) => setFormData(prev => ({
              ...prev,
              metadata: prev.metadata ? { ...prev.metadata, ...updates } : updates as PlanMetadata
            }))}
          />

          {/* Section: Customize Fields */}
          <section className="space-y-6">
            <div className="flex gap-6 items-center">
              <h2 className="text-lg">Customize Fields</h2>
              <Button
                variant="secondary"
                size="md"
                onClick={() => setShowImportModal(true)}
              >
                <Copy className="w-3.5 h-3.5 mr-2" />
                Import from Another Plan...
              </Button>
            </div>
            
            <div className="grid gap-6">
              {formData.config.customFields.map((field, index) => (
                <FieldCard 
                  key={index}
                  field={field}
                  index={index}
                  isError={errorFields.includes(index)}
                  onUpdate={handleUpdateField}
                  onRemove={handleRemoveField}
                />
              ))}
            </div>

            <button 
              onClick={handleAddField}
              className="w-full group py-8 border-2 border-dashed border-border rounded-md flex flex-col items-center justify-center gap-2 opacity-70 hover:opacity-100 hover:border-accent/40 hover:bg-accent/5 transition-all duration-300"
            >
              <Plus className="w-6 h-6" />
              <p className="text-[11px] font-bold uppercase tracking-widest">Add Field</p>
            </button>
          </section>

          <section className="space-y-4">
            <h2 className="text-lg">Connectors</h2>
            <p className="text-sm text-text-secondary">
              Configure external sync targets (REST, gRPC gateway, webhooks, exports).
            </p>

            <div className="space-y-4">
              {connectors.map((connector) => {
                const draft = connectorConfigDrafts[connector.id] ?? JSON.stringify(connector.config || {}, null, 2);
                const status = getConnectorStatus(connector);

                return (
                  <div key={connector.id} className="rounded-md border border-border p-4 space-y-3 bg-card">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold">{connector.name}</p>
                        <p className="text-xs text-text-secondary">{connector.description}</p>
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={connector.enabled}
                          onChange={(e) => handleConnectorToggle(connector.id, e.target.checked)}
                        />
                        Enabled
                      </label>
                    </div>

                    <textarea
                      aria-label={`${connector.name} connector configuration JSON`}
                      value={draft}
                      onChange={(e) => handleConnectorConfigChange(connector.id, e.target.value)}
                      onBlur={() => handleConnectorConfigBlur(connector.id)}
                      rows={4}
                      className="w-full resize-y bg-bg border border-border rounded-md px-3 py-2 text-[12px] font-mono focus:ring-1 focus:ring-accent focus:border-accent outline-none"
                    />

                    <div className="flex items-center justify-between gap-3">
                      <Button variant="secondary" size="sm" onClick={() => handleConnectorTest(connector.id)}>
                        Test Connection
                      </Button>
                      {status && (
                        <span className="text-xs text-text-secondary">{status}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Migration Workflow Modal */}
        <MigrationDialog 
          isOpen={currentStepIndex !== -1}
          onClose={() => {
            setMigrationQueue([]);
            setCurrentStepIndex(-1);
          }}
          onConfirm={resolveDeletion}
          queue={migrationQueue as MigrationStep[]}
          currentIndex={currentStepIndex}
          targetId={migrationTargetId}
          setTargetId={setMigrationTargetId}
          config={formData.config}
        />

        <Modal
          isOpen={showImportModal}
          onClose={() => setShowImportModal(false)}
          title="Import settings from another plan..."
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowImportModal(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleContinueImport}>
                Continue...
              </Button>
            </div>
          }
        >
          <div className="space-y-2 text-sm text-text-primary">
            <p className='text-lg'> Steps</p>
            <p>1. Navigate to the <code>plan-inplace</code> folder of the target plan.</p>
            <p>2. Select <code>metadata.json</code>.</p>
          </div>
        </Modal>
      </div>
    );
  }
);
