import {useGlobalConfig} from '@airtable/blocks/interface/ui';
import {App} from './App';

// Remount the whole app when a grain table changes.
//
// The field pickers are scoped to the tables above them, so when the user
// repoints `shiftsTable`, every field property below it still holds a field
// from the OLD table until the component remounts. Keying on the table ids
// forces that remount and the pickers re-scope cleanly.
export function MonthlyScheduleRoot() {
    const globalConfig = useGlobalConfig();
    const shifts = globalConfig.get('shiftsTable') || '_';
    const days = globalConfig.get('daysTable') || '_';
    const weeks = globalConfig.get('weeksTable') || '_';
    const months = globalConfig.get('monthsTable') || '_';

    return <App key={`${shifts}::${days}::${weeks}::${months}`} />;
}
