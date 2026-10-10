import { events } from 'hatchable';

export const access = 'admin';
export const methods = ['GET'];

export default async function (req, res) {
  return res.json(await events.grant(['kisansetu-queue']));
}