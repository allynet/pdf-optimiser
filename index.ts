import express from 'express';
import {
  readFileSync,
  mkdir as mkdirCb,
  rm,
  access as accessCb,
  PathLike,
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
  execFile as execFileCb,
} from 'child_process';
import type {
  ExecFileOptions,
} from 'child_process';
import helmet from 'helmet';
import { promisify } from 'util';

const execFileAsync = promisify(execFileCb);
const mkdirAsync = promisify(mkdirCb);
const accessAsync = promisify(accessCb);

const fileExists =
  async (path: PathLike, mode?: number) => {
    try {
      await accessAsync(path, mode);
      return true;
    } catch {
      return false;
    }
  }
  ;

const execFile =
  (
    file: string,
    args: readonly string[],
    options?: (ObjectEncodingOptions & ExecFileOptions) | undefined | null,
  ) =>
    execFileAsync(
      file,
      args,
      options,
    )
      .catch(() => null)
  ;

const template =
  (...names: readonly [string, ...string[]]) =>
    join(
      __dirname,
      './templates',
      ...names.slice(0, -1),
      `${names[names.length - 1]}.html`,
    )
  ;

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3000);

const app = express();

app.disable('x-powered-by');
app.disable('etag');

app.use(helmet({
  hidePoweredBy: false,
  contentSecurityPolicy: false,
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

      return mkdirCb(
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
  },
});

const compressionToSetting =
  (compression: string) => {
    switch (compression) {
      case 'best':
        return 'screen';
      case 'medium':
        return 'printer';
      case 'low':
        return 'prepress';
      default:
        return 'default';
    }
  }
  ;

app.get('/', (_req, res) => {
  res.sendFile(template('index'));
});

app.post('/', upload.array('pdf'), async (req, res, next) => {
  const files = req.files as Express.Multer.File[];

  if ((files?.length || 0) === 0) {
    return res.sendStatus(404);
  }

  const basePath = files[0].destination;
  const optimizedPath = join(basePath, 'optimized');
  await mkdirAsync(optimizedPath, {
    recursive: true
  });

  const compression = compressionToSetting(req.body.compression);

  const results = await Promise.all(
    files.map(async (file) => {
      const finalPathBase = join(optimizedPath, file.originalname);
      const finalPath =
        await fileExists(finalPathBase)
          ? join(optimizedPath, `_${file.originalname}`)
          : finalPathBase
        ;
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

      if (!proc) {
        return null;
      }

      return finalPath;
    }),
  );

  const zipped = await execFile(
    'zip',
    [
      '-0',
      '--junk-paths',
      'optimized.zip',
      ...results.filter((x) => x) as string[],
    ],
    {
      cwd: optimizedPath,
    }
  );

  if (!zipped) {
    return res.sendStatus(500);
  }

  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store',
  });
  res.download(join(optimizedPath, 'optimized.zip'), 'optimized.zip', () => {
    next();
  });
}, (req, res) => {
  const files = req.files as Express.Multer.File[];

  if ((files?.length || 0) === 0) {
    return;
  }

  const folder = files[0].destination;

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

app.all('*', (_req, res) => {
  res.sendStatus(404);
})

app.listen(PORT, HOST, () => {
  console.log(`Server listening on ${HOST}:${PORT}`);
});
