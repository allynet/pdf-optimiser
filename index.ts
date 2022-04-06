import express from 'express';
import {
  readFileSync,
  mkdir,
  rm,
} from 'fs';
import type {
  ObjectEncodingOptions,
} from 'fs';
import multer from 'multer';
import {
  tmpdir,
} from 'os';
import {
  join,
} from 'path';
import {
  ChildProcess,
  execFile as execFileCb,
} from 'child_process';
import type {
  ExecFileOptions,
} from 'child_process';
import helmet from 'helmet';

const execFile =
  (
    file: string,
    args: readonly string[],
    options?: (ObjectEncodingOptions & ExecFileOptions) | undefined | null,
  ) =>
    new Promise<ChildProcess>((resolve) => {
      const fp = execFileCb(file, args, options);

      fp.on('close', () => resolve(fp));
    })
  ;

const templates = {
  index: readFileSync('./templates/index.html', 'utf8'),
} as const;

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3000);

const app = express();

app.disable('x-powered-by');
app.disable('etag');

app.use(helmet({
  hidePoweredBy: false,
}));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const parts = [
        'pdf-optimizer',
        Date.now().toString(36),
        process.hrtime.bigint().toString(36),
        Math.random().toString(36).slice(2),
      ] as const;

      const filePath = join(
        tmpdir(),
        parts.join('-'),
      );

      return mkdir(
        filePath,
        {
          recursive: true,
        },
        (err) => cb(err, filePath),
      );
    },
  }),
  fileFilter: (req, file, cb) => cb(null, file.mimetype === 'application/pdf'),
  limits: {
    fileSize: 1024 * 1024 * 1024,
    fields: 1,
  },
});

app.get('/', (req, res) => {
  res.send(templates.index);
});

app.post('/', upload.single('pdf'), async (req, res, next) => {
  const file = req.file;

  if (!file) {
    return res.sendStatus(404);
  }

  const finalPath = `${file.path}.optimized.pdf`;

  const compression = (() => {
    switch (req.body.compression) {
      case 'best':
        return 'screen';
      case 'medium':
        return 'printer';
      case 'low':
        return 'prepress';
      default:
        return 'default';
    }
  })();

  const proc = await execFile(
    "ps2pdf",
    [
      "-dBATCH",
      "-dNOPAUSE",
      "-dCompressFonts=true",
      `-dPDFSETTINGS=/${compression}`,
      file.path,
      finalPath,
    ],
    {
      cwd: file.destination,
    },
  );

  if (proc.exitCode !== 0) {
    return res.sendStatus(500);
  }

  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store',
  });
  res.download(finalPath, file.originalname, () => {
    next();
  });
}, (req, res) => {
  const folder = req.file?.destination;

  if (!folder) {
    return;
  }

  rm(
    folder,
    {
      recursive: true,
      force: true,
    },
    () => {
      res.end();
    },
  );
});

app.all('*', (req, res) => {
  res.sendStatus(404);
})

app.listen(PORT, HOST, () => {
  console.log(`Server listening on ${HOST}:${PORT}`);
});
