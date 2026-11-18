import './styles/main.css';
import { App } from './app/app';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const app = new App(canvas, ui);
(window as unknown as { __app: App }).__app = app; // handy for debugging / tests
