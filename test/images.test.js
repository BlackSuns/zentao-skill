import assert from "node:assert/strict";
import test from "node:test";
import { extractBugImages } from "../src/zentao/images.js";

test("extractBugImages parses HTML <img> tags from steps", () => {
  const bug = {
    id: 100,
    steps: `<p>Steps to reproduce:</p><img src="/zentao/file-read-123.png" alt="preview" /><p>Done</p>`,
  };
  const images = extractBugImages(bug, "http://172.31.80.150:81/zentao");
  assert.equal(images.length, 1);
  assert.equal(images[0].url, "http://172.31.80.150:81/zentao/file-read-123.png");
  assert.equal(images[0].filename, "file-read-123.png");
  assert.equal(images[0].source, "steps");
});

test("extractBugImages parses markdown image tags and ZenTao internal {id.png} tags", () => {
  const bug = {
    id: 101,
    steps: `Here is a picture: ![screen](file-read-456.jpg) and also {789.png}`,
  };
  const images = extractBugImages(bug, "http://172.31.80.150:81/zentao");
  assert.equal(images.length, 2);
  assert.equal(images[0].url, "http://172.31.80.150:81/zentao/file-read-456.jpg");
  assert.equal(images[1].url, "http://172.31.80.150:81/zentao/file-read-789.png");
});

test("extractBugImages includes attachment files and comments", () => {
  const bug = {
    id: 102,
    steps: "Nothing here",
    files: [
      {
        id: 555,
        title: "error_log.png",
        extension: "png",
        webPath: "/zentao/data/upload/1/error_log.png",
      },
      {
        id: 556,
        title: "document.pdf",
        extension: "pdf",
        webPath: "/zentao/data/upload/1/doc.pdf",
      },
    ],
    actions: [
      {
        comment: `<img src="http://172.31.80.150:81/zentao/file-read-999.png" />`,
      },
    ],
  };
  const images = extractBugImages(bug, "http://172.31.80.150:81/zentao");
  assert.equal(images.length, 2);
  assert.equal(images[0].source, "attachment");
  assert.equal(images[0].filename, "error_log.png");
  assert.equal(images[1].source, "action_comment");
  assert.equal(images[1].filename, "file-read-999.png");
});

test("extractBugImages deduplicates identical URLs", () => {
  const bug = {
    id: 103,
    steps: `<img src="/zentao/file-read-123.png" /><img src="/zentao/file-read-123.png" />`,
  };
  const images = extractBugImages(bug, "http://172.31.80.150:81/zentao");
  assert.equal(images.length, 1);
});
