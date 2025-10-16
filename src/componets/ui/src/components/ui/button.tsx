import * as React from "react";
export const Button = ({ className="", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button className={`px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 ${className}`} {...props} />
);
export default Button;
