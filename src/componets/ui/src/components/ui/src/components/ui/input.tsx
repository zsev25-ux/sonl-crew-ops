import * as React from "react";
export const Input = ({ className="", ...props }: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input className={`border rounded-lg px-3 py-2 text-sm w-full ${className}`} {...props} />
);
export default Input;
