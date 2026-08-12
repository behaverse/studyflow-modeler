/**
 * `npm run dev` — starts both app dev servers: the modeler on :5173 and the
 * runner on :5174. The modeler proxies `/run`, `/assessment-unity`, and
 * `/api/llm` to the runner so http://localhost:5173 serves the whole site on
 * one origin (the diagram hand-off between the apps rides on localStorage).
 */
import { spawn } from 'node:child_process';

const children = ['@behaverse/studyflow-modeler', '@behaverse/studyflow-runner'].map((pkg) =>
  spawn('npm', ['run', 'dev', '-w', pkg], { stdio: 'inherit' }),
);

const stop = () => {
  for (const child of children) child.kill('SIGINT');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) child.on('exit', stop);
