import { PDFDocumentProxy } from "pdfjs-dist";

export async function renderPdfPageToUrl(pdf: PDFDocumentProxy, pageNumber: number): Promise<string> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = window.document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create a PDF rendering context.");
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  const image = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
  if (!image) throw new Error("Could not render the PDF page.");
  return URL.createObjectURL(image);
}
