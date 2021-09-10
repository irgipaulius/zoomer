# zoomer
Automatic Zoom downloader that actually works.

Input your credentials in config.js, setup crontab, and it will download zoom recordings into a `DESTINATION` directory with a nice file structure.

Idempotent - meaning it does not download the same recording twice.

### File destination location:

> `DESTINATION`/`topic`/`date topic postfix`/`date_zoom_postfix.extention`

### install:

```console
git clone https://github.com/irgipaulius/zoomer.git
cd zoomer
npm install

edit config.js # insert configuration
npm start
```

### crontab hint:

```cron
*/5 * * * * /usr/local/bin/node /root/zoomer/index.js
```

### manual trigger

```console
npm run start
```
