import { initializeBlock } from "@airtable/blocks/interface/ui";
import { SalesChartRoot } from "./components/App";
import "./style.css";

initializeBlock({ interface: () => <SalesChartRoot /> });
