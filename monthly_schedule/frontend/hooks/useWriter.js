// Shared write discipline.
//
// Every write in this extension follows the same shape:
//   1. build a `fields` object keyed by field.id;
//   2. ask Airtable for permission and surface its own reasonDisplayString
//      VERBATIM — a generic "modification refusée" hides which restriction
//      actually fired, and the user cannot act on it;
//   3. block the control while saving;
//   4. let useRecords re-render when Airtable confirms. No optimistic UI: on a
//      payroll screen, showing a value that has not been persisted is worse
//      than showing a stale one for half a second.

import {useCallback, useState} from 'react';
import {chunkArray} from '../utils/airtable';
import {MAX_RECORDS_PER_CALL} from '../constants';

export function useWriter() {
    const [saving, setSaving] = useState(false);
    const [feedback, setFeedback] = useState(null);

    const clear = useCallback(() => setFeedback(null), []);

    // One record, one set of fields.
    const updateRecord = useCallback(async (table, record, fields, successMessage) => {
        if (!table || !record) return false;
        const check = table.checkPermissionsForUpdateRecord(record, fields);
        if (!check.hasPermission) {
            setFeedback({
                type: 'error',
                message: check.reasonDisplayString ?? 'Modification refusée par Airtable.',
            });
            return false;
        }
        setSaving(true);
        try {
            await table.updateRecordAsync(record, fields);
            if (successMessage) setFeedback({type: 'success', message: successMessage});
            return true;
        } catch (err) {
            setFeedback({type: 'error', message: `Échec de la modification : ${err.message}`});
            return false;
        } finally {
            setSaving(false);
        }
    }, []);

    // Many records, same shape. Airtable rejects more than 50 per call and does
    // not roll back a partial failure, so report how many actually landed rather
    // than claiming the whole batch failed.
    const updateRecords = useCallback(async (table, updates, buildMessage) => {
        if (!table || !updates.length) return false;

        const check = table.checkPermissionsForUpdateRecord(updates[0].record, updates[0].fields);
        if (!check.hasPermission) {
            setFeedback({
                type: 'error',
                message: check.reasonDisplayString ?? 'Modification refusée par Airtable.',
            });
            return false;
        }

        setSaving(true);
        let done = 0;
        try {
            for (const batch of chunkArray(updates, MAX_RECORDS_PER_CALL)) {
                await table.updateRecordsAsync(
                    batch.map((u) => ({id: u.record.id, fields: u.fields})),
                );
                done += batch.length;
            }
            setFeedback({type: 'success', message: buildMessage(done)});
            return true;
        } catch (err) {
            setFeedback({
                type: 'error',
                message: `Échec après ${done} modification(s) réussie(s) : ${err.message}`,
            });
            return false;
        } finally {
            setSaving(false);
        }
    }, []);

    return {saving, feedback, setFeedback, clear, updateRecord, updateRecords};
}

// One banner, coloured by outcome. Deliberately not a floating toast: this sits
// in the flow next to what it is talking about, and stays until dismissed so a
// failed payroll write cannot scroll away unnoticed.
export function Feedback({feedback, onClose}) {
    if (!feedback) return null;
    return (
        <div
            className={
                'flex items-start gap-2 rounded border px-3 py-2 text-xs text-gray-gray900 ' +
                (feedback.type === 'error'
                    ? 'border-red-red bg-red-redLight2'
                    : 'border-green-green bg-green-greenLight2')
            }
            role="status"
        >
            <span className="flex-1">{feedback.message}</span>
            <button
                type="button"
                onClick={onClose}
                className="shrink-0 font-mono text-sm leading-none text-gray-gray600 hover:text-gray-gray900"
                aria-label="Fermer"
            >
                ×
            </button>
        </div>
    );
}
