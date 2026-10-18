import { app } from 'electron'

// Separate data folder for tests / portable use (before the lock, which is per data folder).
if (process.env.NETPLAIN_DATA) app.setPath('userData', process.env.NETPLAIN_DATA)

// A second start only brings the first window forward (its 'second-instance' event); nothing else of it runs.
if (app.requestSingleInstanceLock()) void import('./app')
else app.quit()
