# Isolated document preview sample

Build and import this resource package using the SDK CLI. Grant attachments.read for a workspace copy of sample.ngpreview, enable the package, and open that file. The iframe reads the authorized document and caption.txt over its private MessagePort. The sample intentionally reads only the first MiB; production renderers should request ranges. It does not convert the document to Markdown.
