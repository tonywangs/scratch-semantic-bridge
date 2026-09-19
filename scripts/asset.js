import {createHash} from 'node:crypto';
export const blankSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>';
export const assetId = createHash('md5').update(blankSvg).digest('hex');
export const costume = {assetId, name: 'synthetic blank', bitmapResolution: 1, md5ext: `${assetId}.svg`, dataFormat: 'svg', rotationCenterX: 0, rotationCenterY: 0};
