import {initializeBlock} from '@airtable/blocks/interface/ui';
import {MonthlyScheduleRoot} from './components/MonthlyScheduleRoot';
import './style.css';

initializeBlock({interface: () => <MonthlyScheduleRoot />});
