import PDFHeader from 'src/core/document/PDFHeader';
import PDFTrailer from 'src/core/document/PDFTrailer';
import PDFName from 'src/core/objects/PDFName';
import PDFNumber from 'src/core/objects/PDFNumber';
import PDFObject from 'src/core/objects/PDFObject';
import PDFRef from 'src/core/objects/PDFRef';
import PDFStream from 'src/core/objects/PDFStream';
import PDFContext from 'src/core/PDFContext';
import PDFCrossRefStream from 'src/core/structures/PDFCrossRefStream';
import PDFObjectStream from 'src/core/structures/PDFObjectStream';
import PDFWriter from 'src/core/writers/PDFWriter';
import { last } from 'src/utils';

class PDFStreamWriter extends PDFWriter {
  static forContext = (context: PDFContext, objectsPerStream = 50) =>
    new PDFStreamWriter(context, objectsPerStream);

  private readonly objectsPerStream: number;

  private constructor(context: PDFContext, objectsPerStream: number) {
    super(context);
    this.objectsPerStream = objectsPerStream;
  }

  protected computeBufferSize() {
    let objectNumber = this.context.largestObjectNumber + 1;

    const header = PDFHeader.forVersion(1, 7);

    let size = header.sizeInBytes() + 2;

    const xrefStream = PDFCrossRefStream.create(this.createTrailerDict());

    const uncompressedObjects: Array<[PDFRef, PDFObject]> = [];
    const compressedObjects: Array<Array<[PDFRef, PDFObject]>> = [];
    const objectStreamRefs: PDFRef[] = [];

    const indirectObjects = this.context.enumerateIndirectObjects();
    for (let idx = 0, len = indirectObjects.length; idx < len; idx++) {
      const indirectObject = indirectObjects[idx];
      const [ref, object] = indirectObject;

      const shouldNotCompress =
        ref === this.context.trailerInfo.Encrypt ||
        object instanceof PDFStream ||
        ref.generationNumber !== 0;

      if (shouldNotCompress) {
        uncompressedObjects.push(indirectObject);
        xrefStream.addUncompressedEntry(ref, size);
        size += this.computeIndirectObjectSize(indirectObject);
      } else {
        let chunk = last(compressedObjects);
        let objectStreamRef = last(objectStreamRefs);
        if (!chunk || chunk.length % this.objectsPerStream === 0) {
          chunk = [];
          compressedObjects.push(chunk);
          objectStreamRef = PDFRef.of(objectNumber++);
          objectStreamRefs.push(objectStreamRef);
        }
        xrefStream.addCompressedEntry(ref, objectStreamRef, chunk.length);
        chunk.push(indirectObject);
      }
    }

    for (let idx = 0, len = compressedObjects.length; idx < len; idx++) {
      const chunk = compressedObjects[idx];
      const ref = objectStreamRefs[idx];
      const objectStream = PDFObjectStream.withContextAndObjects(
        this.context,
        chunk,
      );

      xrefStream.addUncompressedEntry(ref, size);
      size += this.computeIndirectObjectSize([ref, objectStream]);

      uncompressedObjects.push([ref, objectStream]);
    }

    const xrefStreamRef = PDFRef.of(objectNumber++);
    xrefStream.dict.set(PDFName.of('Size'), PDFNumber.of(objectNumber));
    xrefStream.addUncompressedEntry(xrefStreamRef, size);
    const xrefOffset = size;
    size += this.computeIndirectObjectSize([xrefStreamRef, xrefStream]);

    uncompressedObjects.push([xrefStreamRef, xrefStream]);

    const trailer = PDFTrailer.forLastCrossRefSectionOffset(xrefOffset);
    size += trailer.sizeInBytes();

    return { size, header, indirectObjects: uncompressedObjects, trailer };
  }
}

export default PDFStreamWriter;