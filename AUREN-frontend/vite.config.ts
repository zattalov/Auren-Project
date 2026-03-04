import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { defineConfig, loadEnv } from 'vite';

import formidable from 'formidable';

function saveDataPlugin() {
  return {
    name: 'save-data-plugin',
    configureServer(server: any) {
      server.middlewares.use('/api/save-data', (req: any, res: any) => {
        if (req.method === 'POST') {
          const form = formidable({ multiples: true });

          form.parse(req, (err, fields, files) => {
            if (err) {
              console.error('Error parsing form data:', err);
              res.statusCode = 500;
              res.end(JSON.stringify({ success: false, error: 'Failed to parse form data' }));
              return;
            }

            try {
              // Parse the JSON data we stringified on the frontend
              const exportDataStr = Array.isArray(fields.jsonData) ? fields.jsonData[0] : fields.jsonData;
              if (!exportDataStr) {
                throw new Error("Missing jsonData in formData");
              }
              const data = JSON.parse(exportDataStr as string);

              const slugName = data.slugName || 'Untitled';
              // 1. Create a dedicated folder for the project using the slug name
              const projectDir = path.join('C:', 'Users', 'AJMN', 'Desktop', 'AUREN backend', 'Data', slugName);

              if (!fs.existsSync(projectDir)) {
                fs.mkdirSync(projectDir, { recursive: true });
              }

              // Save the JSON file inside the new project folder
              const jsonFilename = `${slugName}.json`;
              const jsonFilePath = path.join(projectDir, jsonFilename);
              fs.writeFileSync(jsonFilePath, JSON.stringify(data, null, 2));

              // 2. Save uploaded images to the same folder
              // Formidable might return single files or arrays of files
              Object.keys(files).forEach((key) => {
                const fileOrFiles = files[key];
                if (!fileOrFiles) return;

                const fileArray = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
                fileArray.forEach((file: formidable.File) => {
                  if (file && file.originalFilename) {
                    const oldPath = file.filepath;
                    const newPath = path.join(projectDir, file.originalFilename);
                    // Copy file to new directory
                    fs.copyFileSync(oldPath, newPath);
                  }
                });
              });

              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, path: projectDir }));
            } catch (error) {
              console.error('Error saving data:', error);
              res.statusCode = 500;
              res.end(JSON.stringify({ success: false, error: 'Failed to save data' }));
            }
          });
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), saveDataPlugin()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api/render': 'http://localhost:4000',
        '/api/projects': 'http://localhost:4000',
      },
    },
  };
});

