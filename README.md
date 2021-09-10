# zoomer
Automatic Zoom downloader that actually works.

Input your credentials in config.js, setup crontab, and it will download zoom recordings into a `DESTINATION` directory with a nice file structure.

Idempotent - meaning it does not download the same recording twice.

## Install:

```console
cd /root    # or wherever you like
git clone https://github.com/irgipaulius/zoomer.git
cd zoomer
npm install

# setup configuration
edit config.js 
npm start

# start cron
crontab -e
*/5 * * * * /usr/local/bin/node /root/zoomer/index.js
```

## File destination location:

> `DESTINATION`/`topic`/`date topic postfix`/`date_zoom_postfix.extention`

