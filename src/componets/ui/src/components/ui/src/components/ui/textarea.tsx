import * as React from "react";
export const Textarea = ({ className="", ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea className={`border rounded-lg px-3 py-2 text-sm w-full ${className}`} {...props} />
);
export default Textarea;
