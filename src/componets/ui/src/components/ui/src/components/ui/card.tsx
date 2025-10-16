import * as React from "react";
export const Card = ({ className="", ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`bg-white border border-slate-200 ${className}`} {...props} />
);
export const CardContent = ({ className="", ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`${className}`} {...props} />
);
