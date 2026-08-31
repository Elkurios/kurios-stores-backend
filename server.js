// ========================================
// KURIOS STORES BACKEND
// Express + PostgreSQL
// ========================================

require("dotenv").config();

const dns = require("dns");

dns.setDefaultResultOrder("ipv4first");

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const app = express();

app.use(express.json());


// ========================================
// MONNIFY PAYMENT CONFIGURATION
// ========================================

/*
    Put these in your .env file:

    MONNIFY_API_KEY=...
    MONNIFY_SECRET_KEY=...
    MONNIFY_CONTRACT_CODE=...
    MONNIFY_BASE_URL=https://sandbox.monnify.com

    Switch MONNIFY_BASE_URL to https://api.monnify.com
    when you go live.
*/

const MONNIFY_API_KEY = process.env.MONNIFY_API_KEY;
const MONNIFY_SECRET_KEY = process.env.MONNIFY_SECRET_KEY;
const MONNIFY_CONTRACT_CODE = process.env.MONNIFY_CONTRACT_CODE;
const MONNIFY_BASE_URL =
    process.env.MONNIFY_BASE_URL ||
    "https://sandbox.monnify.com";


// ========================================
// GET A MONNIFY ACCESS TOKEN
// ========================================

/*
    Monnify's API is protected by OAuth2.
    We exchange our API key + secret key for
    a short-lived access token, then use that
    token (as a Bearer header) on every other
    Monnify request.
*/

async function getMonnifyAccessToken() {

    const credentials =
        Buffer.from(
            MONNIFY_API_KEY + ":" + MONNIFY_SECRET_KEY
        ).toString("base64");

    const response = await fetch(
        MONNIFY_BASE_URL + "/api/v1/auth/login",
        {
            method: "POST",
            headers: {
                "Authorization": "Basic " + credentials,
                "Content-Type": "application/json"
            },
            signal: AbortSignal.timeout(15000)
        }
    );

    const data = await response.json();

    if (!data.requestSuccessful) {

        throw new Error(
            "Could not authenticate with Monnify: " +
            (data.responseMessage || "Unknown error")
        );

    }

    return data.responseBody.accessToken;

}


// ========================================
// PROFILE PICTURE UPLOADS
// ========================================

/*
    Uploaded profile pictures are saved to
    an "uploads" folder next to this file,
    and served back out at /uploads/<file>.
*/

const uploadsFolder = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadsFolder)) {
    fs.mkdirSync(uploadsFolder);
}

app.use("/uploads", express.static(uploadsFolder));

const profilePictureStorage = multer.diskStorage({

    destination: function (req, file, cb) {
        cb(null, uploadsFolder);
    },

    filename: function (req, file, cb) {

        const uniqueSuffix =
            Date.now() +
            "-" +
            crypto.randomInt(100000, 999999);

        cb(
            null,
            "profile-" +
                uniqueSuffix +
                path.extname(file.originalname)
        );

    }

});

const profilePictureUpload = multer({

    storage: profilePictureStorage,

    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB max
    },

    fileFilter: function (req, file, cb) {

        const allowedTypes =
            ["image/jpeg", "image/png", "image/webp"];

        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("Only JPG, PNG, or WEBP images are allowed."));
        }

    }

});


// ========================================
// EMAIL CONFIGURATION (Resend HTTPS API)
// ========================================

/*
    Render does not support outbound IPv6, and Gmail's
    SMTP server resolves to an IPv6 address from Render's
    network — so raw SMTP to Gmail fails with ENETUNREACH.

    Resend sends email over a normal HTTPS API call instead
    of a raw SMTP socket, which avoids that problem entirely.

    Put this in your Render Environment Variables:

    RESEND_API_KEY=...
    EMAIL_FROM=Kurios Stores <onboarding@resend.dev>

    (Once you verify your own domain on Resend, change
    EMAIL_FROM to something like
    "Kurios Stores <no-reply@kuriosstores.com>".)
*/

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM =
    process.env.EMAIL_FROM ||
    "Kurios Stores <onboarding@resend.dev>";

async function sendEmail({ to, subject, html }) {

    const response = await fetch(
        "https://api.resend.com/emails",
        {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + RESEND_API_KEY,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                from: EMAIL_FROM,
                to: [to],
                subject: subject,
                html: html
            })
        }
    );

    const data = await response.json();

    if (!response.ok) {

        throw new Error(
            "Resend error: " +
            (data.message || JSON.stringify(data))
        );

    }

    return data;

}

if (!RESEND_API_KEY) {
    console.error(
        "Email configuration error: RESEND_API_KEY is not set."
    );
} else {
    console.log("Email is configured via Resend.");
}

// ========================================
// MIDDLEWARE
// ========================================

app.use(cors());


// =============================================
// POSTGRESQL CONNECTION
// =============================================

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// ========================================
// TEST DATABASE CONNECTION
// ========================================

pool.query("SELECT NOW()")
    .then(() => {
        console.log(
            "Kurios Stores connected to PostgreSQL successfully."
        );
    })
    .catch((error) => {
        console.error(
            "PostgreSQL connection failed:",
            error.message
        );
    });


// ========================================
// AUTO-MIGRATE BASE TABLES
// ========================================

/*
    Creates the core tables this app needs if
    they don't already exist — so a brand new
    database (like on a fresh Render deploy)
    works without anyone running SQL by hand.
    Existing tables/data are left untouched.
*/

async function ensureBaseTablesExist() {

    try {

        await pool.query(
            `
            CREATE TABLE IF NOT EXISTS students (
                id SERIAL PRIMARY KEY,
                first_name TEXT NOT NULL,
                last_name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                phone TEXT,
                whatsapp_number TEXT,
                university TEXT,
                student_id TEXT,
                password_hash TEXT NOT NULL,
                agreed_terms BOOLEAN DEFAULT false,
                agreed_privacy BOOLEAN DEFAULT false,
                receive_notifications BOOLEAN DEFAULT true,
                email_verified BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
            `
        );

        await pool.query(
            `
            CREATE TABLE IF NOT EXISTS student_verification_codes (
                id SERIAL PRIMARY KEY,
                student_id INTEGER REFERENCES students(id),
                otp TEXT NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                verified BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT NOW()
            )
            `
        );

        await pool.query(
            `
            CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                price NUMERIC(12, 2) NOT NULL,
                image_url TEXT,
                category TEXT,
                stock_quantity INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW()
            )
            `
        );

        console.log(
            "Base tables (students, student_verification_codes, products) are ready."
        );

    } catch (error) {

        console.error(
            "Could not create base tables:",
            error.message
        );

    }

}


// ========================================
// AUTO-MIGRATE NEW PROFILE COLUMNS
// ========================================

/*
    Adds the date_of_birth and profile_picture
    columns to the students table if they don't
    already exist yet, so nothing needs to be
    run manually in psql.
*/

async function ensureProfileColumnsExist() {

    try {

        await pool.query(
            `
            ALTER TABLE students
            ADD COLUMN IF NOT EXISTS date_of_birth DATE
            `
        );

        await pool.query(
            `
            ALTER TABLE students
            ADD COLUMN IF NOT EXISTS profile_picture TEXT
            `
        );

        console.log(
            "Profile columns (date_of_birth, profile_picture) are ready."
        );

    } catch (error) {

        console.error(
            "Could not add profile columns:",
            error.message
        );

    }

}


// ========================================
// AUTO-MIGRATE ORDERS TABLE
// ========================================

async function ensureOrdersTableExists() {

    try {

        await pool.query(
            `
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                student_id INTEGER REFERENCES students(id),
                payment_reference TEXT UNIQUE NOT NULL,
                transaction_reference TEXT,
                items JSONB NOT NULL,
                amount NUMERIC(12, 2) NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
            `
        );

        console.log(
            "Orders table is ready."
        );

    } catch (error) {

        console.error(
            "Could not create orders table:",
            error.message
        );

    }

}


// ========================================
// RUN ALL MIGRATIONS, IN ORDER
// ========================================

/*
    These run one after another (not all at
    once) because later ones depend on earlier
    ones — the orders table references students,
    and the profile columns are added onto
    students, so students has to exist first.
*/

async function runMigrations() {

    await ensureBaseTablesExist();
    await ensureProfileColumnsExist();
    await ensureOrdersTableExists();

}

runMigrations();


// ========================================
// HOME ROUTE
// ========================================

app.get("/", (req, res) => {

    res.send("Kurios Stores Backend is Working!");

});


// ========================================
// GET PRODUCTS
// ========================================

app.get("/api/products", async (req, res) => {

    try {

        const result = await pool.query(
            "SELECT * FROM products ORDER BY id ASC"
        );

        res.json(result.rows);

    } catch (error) {

        console.error(
            "Error fetching products:",
            error.message
        );

        res.status(500).json({
            error: "Unable to retrieve products"
        });

    }

});


// ========================================
// STUDENT REGISTRATION
// ========================================

app.post("/api/students/register", async (req, res) => {

    try {

        const {
            firstName,
            lastName,
            email,
            phone,
            whatsappNumber,
            university,
            studentId,
            password,
            confirmPassword,
            agreedStudent,
            agreedTerms,
            agreedPrivacy,
            receiveNotifications
        } = req.body;


        // ====================================
        // REQUIRED FIELD VALIDATION
        // ====================================

        if (
            !firstName ||
            !lastName ||
            !email ||
            !phone ||
            !university ||
            !studentId ||
            !password ||
            !confirmPassword
        ) {

            return res.status(400).json({
                success: false,
                message: "Please fill in all required fields."
            });

        }


        // ====================================
        // PASSWORD MATCH
        // ====================================

        if (password !== confirmPassword) {

            return res.status(400).json({
                success: false,
                message: "Passwords do not match."
            });

        }


        // ====================================
        // STUDENT CONFIRMATION
        // ====================================

        if (!agreedStudent) {

            return res.status(400).json({
                success: false,
                message: "Please confirm that you are a student."
            });

        }


        // ====================================
        // TERMS & PRIVACY
        // ====================================

        if (!agreedTerms || !agreedPrivacy) {

            return res.status(400).json({
                success: false,
                message:
                    "You must agree to the Terms and Privacy Policy."
            });

        }


        // ====================================
// CHECK EXISTING EMAIL
// ====================================

const emailCheck = await pool.query(
    `
    SELECT
        id,
        first_name,
        last_name,
        email,
        phone,
        whatsapp_number,
        university,
        student_id,
        password_hash,
        agreed_terms,
        agreed_privacy,
        receive_notifications,
        email_verified
    FROM students
    WHERE LOWER(email) = LOWER($1)
    LIMIT 1
    `,
    [email.trim()]
);


// ====================================
// EXISTING EMAIL FOUND
// ====================================

if (emailCheck.rows.length > 0) {

    const existingStudent =
        emailCheck.rows[0];


    // ====================================
    // VERIFIED ACCOUNT ALREADY EXISTS
    // ====================================

    if (existingStudent.email_verified) {

        return res.status(409).json({

            success: false,

            message:
                "An account with this email already exists. Please log in instead."

        });

    }


    // ====================================
    // UNVERIFIED REGISTRATION
    // ====================================

    console.log(
        "Unverified registration found. Continuing registration:",
        existingStudent.email
    );


    // ====================================
    // CHECK STUDENT ID
    // AGAINST OTHER ACCOUNTS
    // ====================================

    const studentIdCheck =
        await pool.query(
            `
            SELECT id
            FROM students
            WHERE university = $1
            AND student_id = $2
            AND id <> $3
            LIMIT 1
            `,
            [
                university.trim(),
                studentId.trim(),
                existingStudent.id
            ]
        );


    if (studentIdCheck.rows.length > 0) {

        return res.status(409).json({

            success: false,

            message:
                "This student ID is already registered for this institution."

        });

    }


    // ====================================
    // HASH NEW PASSWORD
    // ====================================

    const passwordHash =
        await bcrypt.hash(
            password,
            12
        );


    // ====================================
    // UPDATE PENDING REGISTRATION
    // ====================================

    const updatedStudent =
        await pool.query(
            `
            UPDATE students
            SET
                first_name = $1,
                last_name = $2,
                phone = $3,
                whatsapp_number = $4,
                university = $5,
                student_id = $6,
                password_hash = $7,
                agreed_terms = $8,
                agreed_privacy = $9,
                receive_notifications = $10,
                email_verified = false,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $11
            RETURNING
                id,
                first_name,
                last_name,
                email,
                phone,
                whatsapp_number,
                university,
                student_id,
                date_of_birth,
                profile_picture
            `,
            [
                firstName.trim(),
                lastName.trim(),
                phone.trim(),
                whatsappNumber
                    ? whatsappNumber.trim()
                    : null,
                university.trim(),
                studentId.trim(),
                passwordHash,
                agreedTerms,
                agreedPrivacy,
                receiveNotifications !== false,
                existingStudent.id
            ]
        );


    // ====================================
    // GENERATE NEW OTP
    // ====================================

    const otp =
        crypto
            .randomInt(
                100000,
                1000000
            )
            .toString();


    const expiresAt =
        new Date(
            Date.now() +
            10 * 60 * 1000
        );


    // ====================================
    // REMOVE OLD OTP
    // ====================================

    await pool.query(
        `
        DELETE FROM student_verification_codes
        WHERE student_id = $1
        AND verified = false
        `,
        [
            existingStudent.id
        ]
    );


    // ====================================
    // SAVE NEW OTP
    // ====================================

    await pool.query(
        `
        INSERT INTO student_verification_codes
        (
            student_id,
            otp,
            expires_at
        )
        VALUES
        ($1, $2, $3)
        `,
        [
            existingStudent.id,
            otp,
            expiresAt
        ]
    );


    // ====================================
    // SEND NEW VERIFICATION EMAIL
    // ====================================

    await sendEmail({

        to:
            updatedStudent.rows[0].email,

        subject:
            "Continue Your Kurios Stores Registration",

        html: `
            <div style="
                font-family: Arial, sans-serif;
                max-width: 600px;
                margin: 0 auto;
                padding: 30px;
                border: 1px solid #e5e7eb;
                border-radius: 12px;
            ">

                <h2 style="
                    color: #5b21b6;
                ">
                    Continue Your Kurios Stores Registration
                </h2>

                <p>
                    Hello
                    <strong>
                        ${updatedStudent.rows[0].first_name}
                    </strong>,
                </p>

                <p>
                    We found an unfinished Kurios Stores
                    registration using this email address.
                </p>

                <p>
                    You can continue your registration.
                    Enter the verification code below
                    to activate your account.
                </p>

                <div style="
                    margin: 25px 0;
                    padding: 20px;
                    text-align: center;
                    background: #f3f0ff;
                    border-radius: 10px;
                ">

                    <span style="
                        font-size: 32px;
                        font-weight: bold;
                        letter-spacing: 8px;
                        color: #5b21b6;
                    ">
                        ${otp}
                    </span>

                </div>

                <p>
                    This verification code will expire
                    in <strong>10 minutes</strong>.
                </p>

                <p>
                    If you did not attempt to register
                    with Kurios Stores, you can ignore
                    this email.
                </p>

                <br>

                <p>
                    Regards,<br>
                    <strong>Kurios Stores</strong>
                </p>

            </div>
        `

    });


    // ====================================
    // CONTINUE REGISTRATION
    // ====================================

    return res.status(200).json({

        success: true,

        requiresVerification: true,

        continueRegistration: true,

        message:
            "We found an unfinished registration for this email. Your registration has been continued and a new verification code has been sent.",

        studentId:
            updatedStudent.rows[0].id,

        email:
            updatedStudent.rows[0].email,

        student:
            updatedStudent.rows[0]

    });

}


        // ====================================
        // CHECK STUDENT ID
        // ====================================

        const studentCheck = await pool.query(
            `
            SELECT id
            FROM students
            WHERE university = $1
            AND student_id = $2
            `,
            [
                university.trim(),
                studentId.trim()
            ]
        );

        if (studentCheck.rows.length > 0) {

            return res.status(409).json({
                success: false,
                message:
                    "This student ID is already registered for this institution."
            });

        }


        // ====================================
        // HASH PASSWORD
        // ====================================

        const passwordHash = await bcrypt.hash(
            password,
            12
        );


        // ====================================
        // SAVE STUDENT
        // ====================================

        const result = await pool.query(
            `
            INSERT INTO students (
                first_name,
                last_name,
                email,
                phone,
                whatsapp_number,
                university,
                student_id,
                password_hash,
                agreed_terms,
                agreed_privacy,
                receive_notifications,
                email_verified
            )
            VALUES (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                $8,
                $9,
                $10,
                $11,
                false
            )
            RETURNING
                id,
                first_name,
                last_name,
                email,
                phone,
                whatsapp_number,
                university,
                student_id,
                date_of_birth,
                profile_picture,
                created_at
            `,
            [
                firstName.trim(),
                lastName.trim(),
                email.trim(),
                phone.trim(),
                whatsappNumber
                    ? whatsappNumber.trim()
                    : null,
                university.trim(),
                studentId.trim(),
                passwordHash,
                agreedTerms,
                agreedPrivacy,
                receiveNotifications !== false
            ]
        );


// ====================================
// GENERATE EMAIL VERIFICATION OTP
// ====================================

const otp = crypto
    .randomInt(100000, 1000000)
    .toString();

const expiresAt = new Date(
    Date.now() + 10 * 60 * 1000
);


// ====================================
// REMOVE OLD OTP CODES
// ====================================

await pool.query(
    `
    DELETE FROM student_verification_codes
    WHERE student_id = $1
    AND verified = false
    `,
    [result.rows[0].id]
);


// ====================================
// SAVE NEW OTP
// ====================================

await pool.query(
    `
    INSERT INTO student_verification_codes
    (
        student_id,
        otp,
        expires_at
    )
    VALUES
    ($1, $2, $3)
    `,
    [
        result.rows[0].id,
        otp,
        expiresAt
    ]
);


// ====================================
// SEND VERIFICATION EMAIL
// ====================================

await sendEmail({

    to: result.rows[0].email,

    subject: "Verify Your Kurios Stores Account",

    html: `
        <div style="
            font-family: Arial, sans-serif;
            max-width: 600px;
            margin: 0 auto;
            padding: 30px;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
        ">

            <h2 style="color: #5b21b6;">
                Welcome to Kurios Stores
            </h2>

            <p>
                Hello <strong>${result.rows[0].first_name}</strong>,
            </p>

            <p>
                Thank you for creating your Kurios Stores
                student account.
            </p>

            <p>
                To activate your account, enter the
                verification code below:
            </p>

            <div style="
                margin: 25px 0;
                padding: 20px;
                text-align: center;
                background: #f3f0ff;
                border-radius: 10px;
            ">

                <span style="
                    font-size: 32px;
                    font-weight: bold;
                    letter-spacing: 8px;
                    color: #5b21b6;
                ">
                    ${otp}
                </span>

            </div>

            <p>
                This verification code will expire in
                <strong>10 minutes</strong>.
            </p>

            <p>
                If you did not create this account,
                please ignore this email.
            </p>

            <br>

            <p>
                Regards,<br>
                <strong>Kurios Stores</strong>
            </p>

        </div>
    `

});


// ====================================
// REGISTRATION SUCCESS
// ====================================

res.status(201).json({

    success: true,

    message:
        "Account created successfully. Please check your email for the verification code.",

    requiresVerification: true,

    studentId: result.rows[0].id,

    email: result.rows[0].email

});

    } catch (error) {

        console.error(
            "Registration error:",
            error.message
        );

        res.status(500).json({

            success: false,

            message:
                "Something went wrong while creating the account."

        });

    }

});

// ========================================
// VERIFY STUDENT EMAIL OTP
// ========================================

app.post("/api/students/verify-otp", async (req, res) => {

    try {

        const {
            studentId,
            otp
        } = req.body;


        // ====================================
        // VALIDATE INPUT
        // ====================================

        if (!studentId || !otp) {

            return res.status(400).json({
                success: false,
                message: "Student ID and verification code are required."
            });

        }


        // ====================================
        // FIND OTP
        // ====================================

        const otpResult = await pool.query(
            `
            SELECT
                id,
                student_id,
                otp,
                expires_at,
                verified
            FROM student_verification_codes
            WHERE student_id = $1
            AND otp = $2
            AND verified = false
            ORDER BY created_at DESC
            LIMIT 1
            `,
            [
                studentId,
                otp.toString().trim()
            ]
        );


        // ====================================
        // INVALID OTP
        // ====================================

        if (otpResult.rows.length === 0) {

            return res.status(400).json({
                success: false,
                message: "Invalid verification code."
            });

        }


        const verificationCode = otpResult.rows[0];


        // ====================================
        // CHECK EXPIRATION
        // ====================================

        if (
            new Date(verificationCode.expires_at) < new Date()
        ) {

            return res.status(400).json({
                success: false,
                message: "This verification code has expired. Please request a new code."
            });

        }


        // ====================================
        // MARK OTP AS VERIFIED
        // ====================================

        await pool.query(
            `
            UPDATE student_verification_codes
            SET verified = true
            WHERE id = $1
            `,
            [verificationCode.id]
        );


        // ====================================
        // VERIFY STUDENT EMAIL
        // ====================================

        const studentResult = await pool.query(
            `
            UPDATE students
            SET email_verified = true,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING
                id,
                first_name,
                last_name,
                email,
                phone,
                whatsapp_number,
                university,
                student_id,
                date_of_birth,
                profile_picture,
                email_verified
            `,
            [studentId]
        );


        // ====================================
        // SUCCESS
        // ====================================

        if (studentResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Student account could not be found."
            });

        }


        res.status(200).json({

            success: true,

            message:
                "Email verified successfully. Your Kurios Stores account is now active.",

            student: studentResult.rows[0]

        });

    } catch (error) {

        console.error(
            "OTP verification error:",
            error.message
        );

        res.status(500).json({

            success: false,

            message:
                "Something went wrong while verifying your account."

        });

    }

});


// ========================================
// RESEND STUDENT EMAIL OTP
// ========================================

app.post("/api/students/resend-otp", async (req, res) => {

    try {

        const {
            studentId,
            email
        } = req.body;


        // ====================================
        // VALIDATE INPUT
        // ====================================

        if (!studentId || !email) {

            return res.status(400).json({

                success: false,

                message:
                    "Student ID and email are required."

            });

        }


        // ====================================
        // FIND STUDENT
        // ====================================

        const studentResult = await pool.query(
            `
            SELECT
                id,
                first_name,
                email,
                email_verified
            FROM students
            WHERE id = $1
            AND LOWER(email) = LOWER($2)
            LIMIT 1
            `,
            [
                studentId,
                email.trim()
            ]
        );


        // ====================================
        // STUDENT NOT FOUND
        // ====================================

        if (studentResult.rows.length === 0) {

            return res.status(404).json({

                success: false,

                message:
                    "Student account could not be found."

            });

        }


        const student =
            studentResult.rows[0];

            console.log("LOGIN USER FOUND:", student.email);


        // ====================================
        // CHECK IF ALREADY VERIFIED
        // ====================================

        if (student.email_verified) {

            return res.status(400).json({

                success: false,

                message:
                    "This student account has already been verified."

            });

        }


        // ====================================
        // GENERATE NEW OTP
        // ====================================

        const otp =
            crypto
                .randomInt(
                    100000,
                    1000000
                )
                .toString();


        // ====================================
        // OTP EXPIRATION
        // ====================================

        const expiresAt =
            new Date(
                Date.now() +
                10 * 60 * 1000
            );


        // ====================================
        // REMOVE OLD OTP
        // ====================================

        await pool.query(
            `
            DELETE FROM student_verification_codes
            WHERE student_id = $1
            AND verified = false
            `,
            [
                student.id
            ]
        );


        // ====================================
        // SAVE NEW OTP
        // ====================================

        await pool.query(
            `
            INSERT INTO student_verification_codes
            (
                student_id,
                otp,
                expires_at
            )
            VALUES
            ($1, $2, $3)
            `,
            [
                student.id,
                otp,
                expiresAt
            ]
        );


        // ====================================
        // SEND NEW OTP EMAIL
        // ====================================

        await sendEmail({

            to:
                student.email,

            subject:
                "Your New Kurios Stores Verification Code",

            html: `
                <div style="
                    font-family: Arial, sans-serif;
                    max-width: 600px;
                    margin: 0 auto;
                    padding: 30px;
                    border: 1px solid #e5e7eb;
                    border-radius: 12px;
                ">

                    <h2 style="color: #5b21b6;">
                        Kurios Stores
                    </h2>

                    <p>
                        Hello
                        <strong>${student.first_name}</strong>,
                    </p>

                    <p>
                        Here is your new email
                        verification code:
                    </p>

                    <div style="
                        margin: 25px 0;
                        padding: 20px;
                        text-align: center;
                        background: #f3f0ff;
                        border-radius: 10px;
                    ">

                        <span style="
                            font-size: 32px;
                            font-weight: bold;
                            letter-spacing: 8px;
                            color: #5b21b6;
                        ">
                            ${otp}
                        </span>

                    </div>

                    <p>
                        This verification code will expire
                        in <strong>10 minutes</strong>.
                    </p>

                    <p>
                        If you did not request a new code,
                        please ignore this email.
                    </p>

                    <br>

                    <p>
                        Regards,<br>
                        <strong>Kurios Stores</strong>
                    </p>

                </div>
            `

        });


        // ====================================
        // RESEND SUCCESS
        // ====================================

        res.status(200).json({

            success: true,

            message:
                "A new verification code has been sent to your email."

        });


    } catch (error) {

        console.error(
            "Resend OTP error:",
            error.message
        );


        res.status(500).json({

            success: false,

            message:
                "Something went wrong while sending a new verification code."

        });

    }

});


// ========================================
// STUDENT LOGIN
// ========================================

app.post("/api/students/login", async (req, res) => {

    try {

        const {
            email,
            password
        } = req.body;


        // ========================================
        // VALIDATE INPUT
        // ========================================

        if (!email || !password) {

            return res.status(400).json({
                success: false,
                message: "Email and password are required."
            });

        }


        // ========================================
        // FIND STUDENT
        // ========================================

        const studentResult = await pool.query(
            `
            SELECT
                id,
                first_name,
                last_name,
                email,
                phone,
                whatsapp_number,
                university,
                student_id,
                date_of_birth,
                profile_picture,
                password_hash,
                email_verified
            FROM students
            WHERE LOWER(email) = LOWER($1)
            LIMIT 1
            `,
            [
                email.trim()
            ]
        );


        // ========================================
        // ACCOUNT NOT FOUND
        // ========================================

        if (studentResult.rows.length === 0) {

            return res.status(401).json({
                success: false,
                message: "Invalid email or password."
            });

        }


        const student =
            studentResult.rows[0];


        // ========================================
        // CHECK EMAIL VERIFICATION
        // ========================================

        if (!student.email_verified) {

            return res.status(403).json({
                success: false,
                message:
                    "Your email has not been verified. Please complete email verification before signing in.",
                requiresVerification: true,
                studentId: student.id,
                email: student.email
            });

        }


        // ========================================
        // CHECK PASSWORD
        // ========================================

        const passwordMatches =
            await bcrypt.compare(
                password,
                student.password_hash
            );

            console.log("PASSWORD MATCH:", passwordMatches);


        if (!passwordMatches) {

            return res.status(401).json({
                success: false,
                message: "Invalid email or password."
            });

        }


        // ========================================
        // SUCCESSFUL LOGIN
        // ========================================

        const {
            password_hash,
            ...safeStudent
        } = student;


        return res.status(200).json({

            success: true,

            message:
                "Login successful. Welcome back to Kurios Stores.",

            student: safeStudent

        });


    } catch (error) {

        console.error(
            "Student login error:",
            error.message
        );


        return res.status(500).json({

            success: false,

            message:
                "Something went wrong while signing you in."

        });

    }

});


// ========================================
// UPDATE STUDENT PROFILE
// (phone, date of birth, profile picture)
// ========================================

app.post(
    "/api/students/update-profile",
    function (req, res, next) {

        // Run multer, but turn its errors into
        // the same JSON error shape as everywhere else.

        profilePictureUpload.single("profilePicture")(
            req,
            res,
            function (error) {

                if (error) {

                    return res.status(400).json({
                        success: false,
                        message: error.message
                    });

                }

                next();

            }
        );

    },
    async (req, res) => {

        try {

            const {
                studentId,
                phone,
                dateOfBirth
            } = req.body;


            // ====================================
            // VALIDATE INPUT
            // ====================================

            if (!studentId) {

                return res.status(400).json({
                    success: false,
                    message: "We couldn't tell which account to update."
                });

            }


            const newProfilePicturePath =
                req.file ?
                    "/uploads/" + req.file.filename :
                    null;


            if (!phone && !dateOfBirth && !newProfilePicturePath) {

                return res.status(400).json({
                    success: false,
                    message: "Nothing was provided to update."
                });

            }


            // ====================================
            // LOOK UP THE CURRENT RECORD
            // (so we know the old picture to remove,
            // and to fall back to existing values)
            // ====================================

            const currentResult = await pool.query(
                `
                SELECT
                    id,
                    phone,
                    date_of_birth,
                    profile_picture
                FROM students
                WHERE id = $1
                LIMIT 1
                `,
                [studentId]
            );

            if (currentResult.rows.length === 0) {

                return res.status(404).json({
                    success: false,
                    message: "Student account could not be found."
                });

            }

            const currentStudent =
                currentResult.rows[0];


            // ====================================
            // UPDATE THE RECORD
            // ====================================

            const updatedResult = await pool.query(
                `
                UPDATE students
                SET
                    phone = $1,
                    date_of_birth = $2,
                    profile_picture = $3,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $4
                RETURNING
                    id,
                    first_name,
                    last_name,
                    email,
                    phone,
                    whatsapp_number,
                    university,
                    student_id,
                    date_of_birth,
                    profile_picture,
                    email_verified
                `,
                [
                    phone ?
                        phone.trim() :
                        currentStudent.phone,

                    dateOfBirth ?
                        dateOfBirth :
                        currentStudent.date_of_birth,

                    newProfilePicturePath ?
                        newProfilePicturePath :
                        currentStudent.profile_picture,

                    studentId
                ]
            );


            // ====================================
            // REMOVE THE OLD PROFILE PICTURE
            // (only once the new one is safely saved)
            // ====================================

            if (
                newProfilePicturePath &&
                currentStudent.profile_picture
            ) {

                const oldFilePath = path.join(
                    uploadsFolder,
                    path.basename(currentStudent.profile_picture)
                );

                fs.unlink(oldFilePath, function (error) {

                    if (error) {

                        console.error(
                            "Could not remove old profile picture:",
                            error.message
                        );

                    }

                });

            }


            // ====================================
            // SUCCESS
            // ====================================

            res.status(200).json({

                success: true,

                message: "Profile updated successfully.",

                student: updatedResult.rows[0]

            });

        } catch (error) {

            console.error(
                "Profile update error:",
                error.message
            );

            res.status(500).json({

                success: false,

                message:
                    "Something went wrong while updating your profile."

            });

        }

    }
);


// ========================================
// CHECKOUT + ORDERS (MONNIFY)
// ========================================

/*
    Recomputes the order total from the real
    products table — never trust a price sent
    from the browser.
*/

async function buildTrustedOrderItems(items) {

    const productIds =
        items.map(function (item) {
            return item.id;
        });

    const productsResult = await pool.query(
        `
        SELECT id, name, price
        FROM products
        WHERE id = ANY($1::int[])
        `,
        [productIds]
    );

    const productMap = {};

    productsResult.rows.forEach(function (product) {
        productMap[product.id] = product;
    });

    let totalAmount = 0;
    const trustedItems = [];

    for (const item of items) {

        const product = productMap[item.id];

        if (!product) {

            throw new Error(
                "One of the items in your cart is no longer available."
            );

        }

        const quantity =
            Math.max(
                1,
                parseInt(item.quantity) || 1
            );

        const lineTotal =
            Number(product.price) * quantity;

        totalAmount += lineTotal;

        trustedItems.push({
            id: product.id,
            name: product.name,
            price: Number(product.price),
            quantity: quantity
        });

    }

    return {
        totalAmount,
        trustedItems
    };

}


/*
    Asks Monnify for the real status of a
    payment and updates our own orders table
    to match. Used by both the manual "verify
    after checkout" call and the webhook.
*/

async function verifyAndUpdateOrder(paymentReference) {

    const orderResult = await pool.query(
        `
        SELECT *
        FROM orders
        WHERE payment_reference = $1
        LIMIT 1
        `,
        [paymentReference]
    );

    if (orderResult.rows.length === 0) {

        return {
            success: false,
            message: "Order not found.",
            order: null
        };

    }

    const order =
        orderResult.rows[0];


    // Already confirmed earlier — no need to ask Monnify again.

    if (order.status === "paid") {

        return {
            success: true,
            message: "Payment already confirmed.",
            order: order
        };

    }


    const accessToken =
        await getMonnifyAccessToken();

    const verifyResponse = await fetch(
        MONNIFY_BASE_URL +
        "/api/v2/merchant/transactions/query?paymentReference=" +
        encodeURIComponent(paymentReference),
        {
            headers: {
                "Authorization": "Bearer " + accessToken
            },
            signal: AbortSignal.timeout(15000)
        }
    );

    const verifyData =
        await verifyResponse.json();

    if (!verifyData.requestSuccessful) {

        return {
            success: false,
            message: "Could not verify this payment with Monnify.",
            order: order
        };

    }


    const paymentStatus =
        verifyData.responseBody.paymentStatus;

    const amountPaid =
        Number(verifyData.responseBody.amountPaid || 0);

    const transactionReference =
        verifyData.responseBody.transactionReference;

    const isPaid =
        (paymentStatus === "PAID" || paymentStatus === "OVERPAID") &&
        amountPaid >= Number(order.amount);

    const isFailed =
        paymentStatus === "FAILED" ||
        paymentStatus === "EXPIRED" ||
        paymentStatus === "REVERSED";

    const newStatus =
        isPaid ?
            "paid" :
            isFailed ?
                "failed" :
                "pending";

    const updatedResult = await pool.query(
        `
        UPDATE orders
        SET
            status = $1,
            transaction_reference = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        RETURNING *
        `,
        [
            newStatus,
            transactionReference,
            order.id
        ]
    );

    return {
        success: isPaid,
        message:
            isPaid ?
                "Payment confirmed." :
                "Payment status: " + paymentStatus,
        order: updatedResult.rows[0]
    };

}


// ========================================
// START A CHECKOUT
// ========================================

app.post("/api/orders/initiate", async (req, res) => {

    try {

        const {
            studentId,
            items,
            customerName,
            customerEmail
        } = req.body;

        if (
            !studentId ||
            !Array.isArray(items) ||
            items.length === 0
        ) {

            return res.status(400).json({
                success: false,
                message: "Your cart is empty."
            });

        }


        let totalAmount;
        let trustedItems;

        try {

            const built =
                await buildTrustedOrderItems(items);

            totalAmount = built.totalAmount;
            trustedItems = built.trustedItems;

        } catch (buildError) {

            return res.status(400).json({
                success: false,
                message: buildError.message
            });

        }


        if (totalAmount <= 0) {

            return res.status(400).json({
                success: false,
                message: "Order total must be greater than zero."
            });

        }


        const paymentReference =
            "kurios_" +
            Date.now() +
            "_" +
            crypto.randomInt(100000, 999999);

        await pool.query(
            `
            INSERT INTO orders (
                student_id,
                payment_reference,
                items,
                amount,
                status
            )
            VALUES ($1, $2, $3, $4, 'pending')
            `,
            [
                studentId,
                paymentReference,
                JSON.stringify(trustedItems),
                totalAmount
            ]
        );


        res.status(200).json({

            success: true,

            paymentReference: paymentReference,

            amount: totalAmount,

            apiKey: MONNIFY_API_KEY,

            contractCode: MONNIFY_CONTRACT_CODE,

            customerName: customerName || "Kurios Student",

            customerEmail: customerEmail || ""

        });

    } catch (error) {

        console.error(
            "Order initiate error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Something went wrong while starting your order."
        });

    }

});


// ========================================
// VERIFY A CHECKOUT (called right after
// the Monnify widget closes)
// ========================================

app.post("/api/orders/verify", async (req, res) => {

    try {

        const { paymentReference } =
            req.body;

        if (!paymentReference) {

            return res.status(400).json({
                success: false,
                message: "Missing payment reference."
            });

        }

        const result =
            await verifyAndUpdateOrder(
                paymentReference
            );

        if (!result.order) {

            return res.status(404).json(result);

        }

        res.status(200).json(result);

    } catch (error) {

        console.error(
            "Order verify error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Something went wrong while verifying your payment."
        });

    }

});


// ========================================
// MONNIFY WEBHOOK
// (catches payments even if the student
// closes the browser before we can verify)
// ========================================

app.post("/api/orders/webhook", async (req, res) => {

    try {

        const paymentReference =
            req.body &&
            req.body.eventData &&
            req.body.eventData.paymentReference;

        if (!paymentReference) {

            // Nothing we recognise — acknowledge
            // anyway so Monnify doesn't keep retrying.

            return res.status(200).send("ignored");

        }

        await verifyAndUpdateOrder(
            paymentReference
        );

        res.status(200).send("ok");

    } catch (error) {

        console.error(
            "Monnify webhook error:",
            error.message
        );

        // Still 200 — Monnify will retry on non-2xx,
        // and we don't want a retry storm over a bug
        // on our side. We'll catch it on next verify.

        res.status(200).send("error logged");

    }

});


// ========================================
// LIST A STUDENT'S ORDERS
// ========================================

app.get("/api/orders", async (req, res) => {

    try {

        const { studentId } =
            req.query;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const result = await pool.query(
            `
            SELECT
                id,
                payment_reference,
                items,
                amount,
                status,
                created_at
            FROM orders
            WHERE student_id = $1
            ORDER BY created_at DESC
            `,
            [studentId]
        );

        res.status(200).json({
            success: true,
            orders: result.rows
        });

    } catch (error) {

        console.error(
            "Fetch orders error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not load your orders."
        });

    }

});




// ========================================
// START SERVER
// ========================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Kurios Stores server is running on port ${PORT}`);
});
