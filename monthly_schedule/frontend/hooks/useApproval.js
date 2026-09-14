// Payroll approval: stamping heures_semaine rows.
//
// An approval is two cells on each heures_semaine row — paie_approuvee_le (a
// Date with time, the actual flag) and paie_approuvee_par (text, optional). A
// row is approved exactly when the date is filled; clearing both withdraws it.
// There is no approval without a heures_semaine row: a week the automation has
// not produced cannot be approved, and the controls say so instead of hiding it.
//
// Writes go through useWriter, so they carry its discipline: permission check
// with Airtable's own reason, blocked controls while saving, no optimistic UI.

import {useCallback} from 'react';
import {useSession} from '@airtable/blocks/interface/ui';
import {useWriter} from './useWriter';

export function useApproval(cp) {
    const session = useSession();
    const writer = useWriter();
    const {updateRecords} = writer;

    const available = Boolean(cp.weeksTable && cp.weekApprovedAtField);

    const approve = useCallback(
        async (weekRows) => {
            if (!available) return false;
            const pending = weekRows.filter((w) => w && !w.approved);
            if (!pending.length) return false;

            const user = session.currentUser;
            const fields = {[cp.weekApprovedAtField.id]: new Date().toISOString()};
            if (cp.weekApprovedByField) {
                fields[cp.weekApprovedByField.id] = user?.name || user?.email || '';
            }
            return updateRecords(
                cp.weeksTable,
                pending.map((w) => ({record: w.record, fields})),
                (n) => `${n} semaine(s) approuvée(s).`,
            );
        },
        [available, cp.weeksTable, cp.weekApprovedAtField, cp.weekApprovedByField, session, updateRecords],
    );

    const withdraw = useCallback(
        async (weekRows) => {
            if (!available) return false;
            const approved = weekRows.filter((w) => w && w.approved);
            if (!approved.length) return false;

            const fields = {[cp.weekApprovedAtField.id]: null};
            if (cp.weekApprovedByField) fields[cp.weekApprovedByField.id] = null;
            return updateRecords(
                cp.weeksTable,
                approved.map((w) => ({record: w.record, fields})),
                (n) => `Approbation retirée sur ${n} semaine(s).`,
            );
        },
        [available, cp.weeksTable, cp.weekApprovedAtField, cp.weekApprovedByField, updateRecords],
    );

    return {
        available,
        approve,
        withdraw,
        saving: writer.saving,
        feedback: writer.feedback,
        clearFeedback: writer.clear,
    };
}
