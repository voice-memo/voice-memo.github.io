const defaultTypeFace = 'Sans-serif';
const LineSpacingFactor = 1.5;

export async function genJpegBlob(text, width, height) {
  width = width || 1920;
  height = height || 1080;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  insertBanner(ctx, text, width, height);
  return new Promise(function(resolve) {
    canvas.toBlob(function(blob) {
      resolve(blob);
    }, 'image/jpeg');
  });
}

export async function genJpegBlobFromImg(imgHtml) {
  const width = 1920;
  const height =  1080;
  const canvas = document.createElement('canvas');

  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(imgHtml, 0, 0, width, height);

  return new Promise(function(resolve) {
    canvas.toBlob(function(blob) {
      resolve(blob);
    }, 'image/jpeg');
  });
}

function insertBanner(ctx, text, width, height) {
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, width, height);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const yBase = height / 2;

  const defaultWidth = 960;
  const actualFontSize = 48 * width / defaultWidth;
  ctx.font = `${actualFontSize}px ${defaultTypeFace}`;
  // Hack: https://stackoverflow.com/a/13318387/2191332
  const maxLineHeight = ctx.measureText('M').width;
  const lines = text.split('\n');
  lines.forEach((lineText, lineIdx) => {
    let y = _computeYFromCenter(yBase, lineIdx, maxLineHeight, lines.length);
    const x = width / 2;
    drawStroked(
      ctx, lineText, x, y, actualFontSize,
      'black', 'white');
  });

}

function _computeYFromCenter(yCenter, idx, maxLineHeight, numLines) {
  const shift = maxLineHeight * (idx - (numLines - 1) / 2);
  return yCenter + shift  * LineSpacingFactor;
}

function drawStroked(ctx, text, x, y, size, strokeStyle, fillStyle) {
  ctx.font = `${size}px ${defaultTypeFace}`;
  ctx.strokeStyle = strokeStyle;
  const strokeToLineRatio = 8;
  ctx.lineWidth = Math.ceil(size / strokeToLineRatio);
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fillStyle;
  ctx.fillText(text, x, y);
}
