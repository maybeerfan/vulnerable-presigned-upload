# Vulnerable Presigned Upload Lab

A fully dockerized lab that reproduces the classic **Content-Type Confusion → Stored XSS** vulnerability in presigned upload flows.

## Real-World Context

This lab is based on a real-world vulnerability pattern in presigned upload flows: an application may validate one content type while the upload service accepts and stores another. This project provides a controlled educational reproduction of that vulnerability class; it does not reproduce a specific product or incident.

## Architecture

| Domain             | Service                               |
| ------------------ | ------------------------------------- |
| `erfan.net`        | Frontend (Login + Uploader + Gallery) |
| `upload.erfan.net` | GraphQL backend                       |
| `s3minio.net`      | MinIO (S3-compatible)                 |
| `cdn.erfan.net`    | CDN (Nginx → MinIO)                   |

## Credentials

Username: labuser 
Password: labpass123

## Quick Start

1. Add the domains to your `/etc/hosts`:

```bash
127.0.0.1   erfan.net
127.0.0.1   upload.erfan.net
127.0.0.1   s3minio.net
127.0.0.1   cdn.erfan.net
````

2. Start the lab:

```bash
docker compose up --build
```

3. Open [http://erfan.net](http://erfan.net/)  
    Login with the credentials above.

## Features

- Real login page
- File uploader
- Gallery that lists all previously uploaded files

## How to trigger the vulnerability

The application always sends Content-Type: image/png on the PUT request.

To exploit:

1. Prepare an SVG file with JavaScript (example below).
2. Login and select the file.
3. Intercept the **PUT** request to s3minio.net.
4. Change the header:


```http
Content-Type: image/png
```

to:

```http
Content-Type: image/svg+xml
```

5. Forward the request.
6. Open the returned CDN URL (or click the image in the gallery).

## Why this is vulnerable

In the vulnerable mode, the presigned URL does not bind the `Content-Type` header to the signature. A user can therefore change that header after receiving the URL while the upload remains authorized. The object storage service records the supplied type as object metadata, even though the backend gives the object a `.png` key.

The backend allows `image/svg+xml`, and the CDN serves uploaded objects from the same site without forcing downloads or preventing MIME-type interpretation. If an SVG containing script is uploaded with `Content-Type: image/svg+xml`, a browser may execute that script when someone opens the CDN URL. This turns an upload into stored cross-site scripting (XSS) against visitors to the site.

In the resolver, the vulnerable behavior occurs when `secure` is false: the `Content-Type` is set on the upload command but is not included in the signature.

```js
const command = new PutObjectCommand({
  Bucket: process.env.MINIO_BUCKET,
  Key: key,
  ContentType: contentType,
});

const signOptions = {
  expiresIn: 3600,
};

// With Secure Mode off, Content-Type is not signed.
const uploadUrl = await getSignedUrl(s3ClientPublic, command, signOptions);
```

The file extension and the client-provided `Content-Type` are not proof of a file's actual contents. Checking or signing the header alone does not establish that the uploaded bytes are a safe image.

## How to fix it

- **Bind the expected type to the signature.** Include `Content-Type` in the signed headers and require the upload to use exactly that value. In this lab, enable **Secure Mode** to demonstrate this control; changing the header then causes the upload signature to fail. Treat this as one layer of defense, not a complete file-safety check.
- **Validate the file contents on the server.** Do not trust the filename, extension, or request header. Inspect the uploaded bytes, enforce size and format limits, and reject formats that are not required. For image-only uploads, disallow SVG unless it is safely sanitized or rasterized.
- **Keep untrusted uploads isolated.** Upload to a private quarantine location, validate or transform the object, and only then publish it. Serve user-controlled content from a separate origin that does not share the application's cookies.
- **Set safe response headers when serving files.** Use an appropriate verified media type, `X-Content-Type-Options: nosniff`, and, where inline display is unnecessary, `Content-Disposition: attachment`. Do not rely on the object key's extension to control browser behavior.

In this lab, checking **Secure Mode** sends `secure: true` to the resolver. The resolver then signs `Content-Type`, so changing that header on the PUT request invalidates the signature:

```js
const signOptions = {
  expiresIn: 3600,
};

if (secure) {
  signOptions.signableHeaders = new Set(['content-type']);
}

const uploadUrl = await getSignedUrl(s3ClientPublic, command, signOptions);
```

### Example XSS Payload

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
  <script type="text/javascript">alert(document.domain)</script>
</svg>
```

## Stopping the lab

```bash
docker compose down -v
```
