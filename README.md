# Pill Reminder

Reminds you to take your pills on time, and remembers whether you did.

A JavaScript app for [BUSY Bar](https://busy.app). Work in progress.

## What it does

- Up to four reminders, each with a name, a time and an on/off switch, plus a repeat interval, are set in the app's settings.
- When idle, the app shows the clock and the next dose, such as `VIT D 21:00`.
- At dose time it shows the reminder with a shaking pill, plays a sound and blinks the status light. Press Start when you have taken it; otherwise it reminds you again after the repeat interval.
- The back display shows the last dose taken, such as `Last: VIT D 08:12`.
- The BUSY Bar runs one app at a time, so reminders come only while this app is open.

## Data

None: it works offline and keeps its log on the BUSY Bar.

## Build

Node 24 and npm:

```sh
npm ci
npm run build         # dist/io.github.vvzvlad.pills.tgz
npm run app:install   # install it on a BUSY Bar connected over USB
npm run app:run       # start it
```

## License

[MIT](LICENSE)
