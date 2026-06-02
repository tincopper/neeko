import * as React from "react";
import {
   Dialog,
   DialogContent,
   DialogHeader,
   DialogTitle,
   DialogDescription,
   DialogFooter,
} from "@/ui/dialog";
import { Button } from "@/ui/button";
import { CloseIcon, TrashIcon } from "./icons";

interface ConfirmDialogProps {
   open: boolean;
   onOpenChange: (open: boolean) => void;
   title: string;
   description: React.ReactNode;
   confirmLabel?: string;
   onConfirm: () => void;
   danger?: boolean;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
   open,
   onOpenChange,
   title,
   description,
   confirmLabel = "Confirm",
   onConfirm,
   danger = false,
}) => {
   return (
      <Dialog open={open} onOpenChange={onOpenChange}>
         <DialogContent>
            <DialogHeader>
               <DialogTitle>{title}</DialogTitle>
            </DialogHeader>
            <DialogDescription asChild>
               <div>{description}</div>
            </DialogDescription>
            <DialogFooter>
               <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onOpenChange(false)}
               >
                  <CloseIcon size={14} />
                  Cancel
               </Button>
               <Button
                  variant={danger ? "destructive" : "primary"}
                  size="sm"
                  onClick={() => {
                     onOpenChange(false);
                     onConfirm();
                  }}
               >
                  <TrashIcon size={13} />
                  {confirmLabel}
               </Button>
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
};

export default React.memo(ConfirmDialog);
