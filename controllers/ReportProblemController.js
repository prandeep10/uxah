import multer from 'multer';
import nodemailer from 'nodemailer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Derive __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log('Uploads directory created:', uploadDir);
}

// Multer setup to handle file uploads
const upload = multer({ 
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, path.join(__dirname, '../uploads/'));
    },
    filename: (req, file, cb) => {
      cb(null, file.originalname);
    }
  })
});

// Define the reportProblemHandler function
const reportProblemHandler = (req, res) => {
  console.log('reportProblemHandler called');
  console.log('Request body:', req.body);
  console.log('Request file:', req.file);

  const { description, problemType, email, priority, additionalInfo } = req.body;
  const attachment = req.file;

  // Set up Nodemailer transporter
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.DB_USERMAIL,
      pass: process.env.DB_PASSKEY,
    },
  });

  console.log('Nodemailer transporter set up');

  const mailOptions = {
    from: process.env.DB_USERMAIL,
    to: process.env.DB_USERMAIL,
    subject: 'Client Reported Problem',
    text: `
      Problem Type: ${problemType}
      Description: ${description}
      Priority: ${priority}
      Additional Info: ${additionalInfo}
      Email: ${email}
    `,
    attachments: attachment
      ? [
          {
            filename: attachment.originalname,
            path: attachment.path,
          },
        ]
      : [],
  };

  console.log('Mail options set up:', mailOptions);

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error('Error sending email:', error);
      return res.status(500).json({ error: 'Error sending email', details: error.message });
    }
    console.log('Email sent successfully:', info.response);
    res.status(200).json({ message: 'Problem reported successfully' });
  });
};

export { upload, reportProblemHandler };
